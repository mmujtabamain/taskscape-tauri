// The mutation layer (B3). Every task change routes through here as an invertible
// Command run on the history stack, so ⌘Z works uniformly and the hot ops apply
// optimistically to `taskStore` before the api round-trip. Drag/positioning math
// lives here too (the store is the single owner of sort_order arithmetic).
import { api, type Task } from '../api';
import type { DropZone } from '../components/TaskRow';
import { collapseToRoots } from '../lib/selection';
import { effSort } from './derive';
import { useHistoryStore, type Command } from './history';
import { useTaskStore } from './taskStore';

const task = (id: string): Task | undefined => useTaskStore.getState().taskById[id];
const run = (cmd: Command) => useHistoryStore.getState().run(cmd);

function isInSubtree(candidateId: string, rootId: string): boolean {
  const { taskById } = useTaskStore.getState();
  let cur: string | null = candidateId;
  while (cur) {
    if (cur === rootId) return true;
    cur = taskById[cur]?.parent_id ?? null;
  }
  return false;
}

// ----- simple invertible commands -----

export function toggleDone(t: Task) {
  const { patch } = useTaskStore.getState();
  const set = async (done: boolean) => {
    patch(t.id, { done });
    try {
      await api.updateTask(t.id, { done });
    } catch (e) {
      patch(t.id, { done: !done });
      throw e;
    }
  };
  return run({
    label: t.done ? 'Mark not done' : 'Mark done',
    apply: () => set(!t.done),
    invert: () => set(t.done),
  });
}

export function setTasksDone(ids: string[], done: boolean) {
  if (ids.length === 0) return Promise.resolve();
  const { taskById, patchMany } = useTaskStore.getState();
  // Remember each task's prior state so the inverse restores a mixed selection
  // exactly (not "all done" → "all not done").
  const prevTrue = ids.filter((id) => taskById[id]?.done);
  const prevFalse = ids.filter((id) => taskById[id] && !taskById[id]!.done);
  return run({
    label: done ? `Mark ${ids.length} done` : `Mark ${ids.length} not done`,
    apply: async () => {
      patchMany(ids, { done });
      await api.setTasksDone(ids, done);
    },
    invert: async () => {
      patchMany(prevTrue, { done: true });
      patchMany(prevFalse, { done: false });
      await Promise.all([
        prevTrue.length ? api.setTasksDone(prevTrue, true) : null,
        prevFalse.length ? api.setTasksDone(prevFalse, false) : null,
      ]);
    },
  });
}

export function rename(id: string, title: string) {
  const prev = task(id)?.title ?? '';
  if (title === prev) return Promise.resolve();
  const { patch } = useTaskStore.getState();
  const set = async (value: string) => {
    patch(id, { title: value });
    try {
      await api.updateTask(id, { title: value });
    } catch (e) {
      patch(id, { title: prev });
      throw e;
    }
  };
  return run({ label: 'Rename', apply: () => set(title), invert: () => set(prev) });
}

// ----- delete (soft, undoable) -----

export function deleteTasks(rootIds: string[]) {
  if (rootIds.length === 0) return Promise.resolve();
  let affected: string[] = [];
  return run({
    label: `Delete ${rootIds.length} task${rootIds.length === 1 ? '' : 's'}`,
    apply: async () => {
      affected = await api.deleteTasks(rootIds);
      await useTaskStore.getState().load();
    },
    invert: async () => {
      await api.restoreTasks(affected);
      await useTaskStore.getState().load();
    },
  });
}

/** Delete a whole selection: collapse to forest roots first (subtrees follow). */
export function deleteSelection(ids: Iterable<string>) {
  const { taskById } = useTaskStore.getState();
  const roots = collapseToRoots(ids, (id) => taskById[id]?.parent_id ?? null);
  return deleteTasks(roots);
}

// ----- positioning (move / reorder / drag), all as one snapshot-restore shape --

interface Snap {
  id: string;
  parent_id: string | null;
  list_id: string;
  sort_order: number;
}
interface Op {
  id: string;
  parentId: string | null;
  listArg: string | null;
  sort?: number;
}

const snapOf = (t: Task): Snap => ({
  id: t.id,
  parent_id: t.parent_id,
  list_id: t.list_id,
  sort_order: t.sort_order,
});

const restore = (s: Snap) =>
  api.moveTask(s.id, s.parent_id, s.parent_id ? null : s.list_id, s.sort_order);

/** Build one undoable command from a set of move ops: snapshot every touched
 *  task's position on apply, run the ops, and restore those positions on invert.
 *  Uniformly covers single moves, drop-rebuilds, multi-drag and bulk-move. */
function reposition(label: string, ops: Op[]): Promise<void> {
  if (ops.length === 0) return Promise.resolve();
  let snaps: Snap[] = [];
  return run({
    label,
    apply: async () => {
      const { taskById, load } = useTaskStore.getState();
      snaps = ops.map((o) => taskById[o.id]).filter(Boolean).map(snapOf);
      await Promise.all(
        ops.map((o) => api.moveTask(o.id, o.parentId, o.listArg, o.sort))
      );
      await load();
    },
    invert: async () => {
      await Promise.all(snaps.map(restore));
      await useTaskStore.getState().load();
    },
  });
}

/** Move to a list / nest / promote (context menu, tab drop). */
export function move(
  id: string,
  parentId: string | null,
  listId: string | null,
  sort?: number
) {
  const listArg = parentId ? null : listId ?? task(id)?.list_id ?? null;
  return reposition('Move', [{ id, parentId, listArg, sort }]);
}

const siblingsOf = (parentId: string | null, listId: string) => {
  const { childrenByParent, rootsByList } = useTaskStore.getState();
  return parentId ? childrenByParent[parentId] ?? [] : rootsByList[listId] ?? [];
};

/** Single-row drop (before/nest/after), with the midpoint-or-rebuild sort math. */
export function dropOnRow(draggedId: string, target: Task, zone: DropZone) {
  if (isInSubtree(target.id, draggedId)) return Promise.resolve();
  if (zone === 'nest') {
    const kids = siblingsOf(target.id, target.list_id).filter((t) => t.id !== draggedId);
    const last = kids[kids.length - 1];
    return reposition('Move', [
      {
        id: draggedId,
        parentId: target.id,
        listArg: null,
        sort: last ? effSort(last) + 1000 : 1000,
      },
    ]);
  }
  const parentId = target.parent_id;
  const listArg = parentId ? null : target.list_id;
  const siblings = siblingsOf(parentId, target.list_id).filter((t) => t.id !== draggedId);
  const targetIdx = siblings.findIndex((t) => t.id === target.id);
  const insertIdx = zone === 'before' ? targetIdx : targetIdx + 1;
  const prev = siblings[insertIdx - 1];
  const next = siblings[insertIdx];

  // Neighbours too close (equal timestamps / midpoints exhausted): rebuild the
  // group at evenly spaced integers with the dragged row in its new slot.
  if (prev && next && effSort(next) - effSort(prev) < 1) {
    const ordered = [
      ...siblings.slice(0, insertIdx).map((t) => t.id),
      draggedId,
      ...siblings.slice(insertIdx).map((t) => t.id),
    ];
    return reposition(
      'Move',
      ordered.map((id, i) => ({ id, parentId, listArg, sort: (i + 1) * 1000 }))
    );
  }

  let sort: number;
  if (!prev) sort = next ? effSort(next) - 1000 : effSort(target) - 1000;
  else if (!next) sort = effSort(prev) + 1000;
  else sort = (effSort(prev) + effSort(next)) / 2;
  return reposition('Move', [{ id: draggedId, parentId, listArg, sort }]);
}

/** Single-row drop onto a pane root (un-nest to the end of the list). */
export function dropOnRoot(draggedId: string, listId: string) {
  const roots = (useTaskStore.getState().rootsByList[listId] ?? []).filter(
    (t) => t.id !== draggedId
  );
  const last = roots[roots.length - 1];
  return reposition('Move', [
    { id: draggedId, parentId: null, listArg: listId, sort: last ? effSort(last) + 1000 : undefined },
  ]);
}

/** Multi-drag onto a row: nest the set, or land it as a contiguous band. */
export function dropSetOnRow(ids: string[], target: Task, zone: DropZone) {
  if (ids.some((id) => isInSubtree(target.id, id))) return Promise.resolve();
  const idset = new Set(ids);
  if (zone === 'nest') {
    const kids = siblingsOf(target.id, target.list_id).filter((t) => !idset.has(t.id));
    const base = kids.length ? effSort(kids[kids.length - 1]) + 1000 : 1000;
    return reposition(
      'Move',
      ids.map((id, i) => ({ id, parentId: target.id, listArg: null, sort: base + i * 1000 }))
    );
  }
  const parentId = target.parent_id;
  const listArg = parentId ? null : target.list_id;
  const siblings = siblingsOf(parentId, target.list_id).filter((t) => !idset.has(t.id));
  const targetIdx = siblings.findIndex((t) => t.id === target.id);
  const insertIdx = zone === 'before' ? targetIdx : targetIdx + 1;
  const ordered = [
    ...siblings.slice(0, insertIdx).map((t) => t.id),
    ...ids,
    ...siblings.slice(insertIdx).map((t) => t.id),
  ];
  return reposition(
    'Move',
    ordered.map((id, i) => ({ id, parentId, listArg, sort: (i + 1) * 1000 }))
  );
}

/** Multi-drag/bulk-move a set of roots to the end of a list's roots. */
export function dropSetOnRoot(ids: string[], listId: string) {
  const idset = new Set(ids);
  const roots = (useTaskStore.getState().rootsByList[listId] ?? []).filter(
    (t) => !idset.has(t.id)
  );
  const base = roots.length ? effSort(roots[roots.length - 1]) + 1000 : 1000;
  return reposition(
    `Move ${ids.length} task${ids.length === 1 ? '' : 's'}`,
    ids.map((id, i) => ({ id, parentId: null, listArg: listId, sort: base + i * 1000 }))
  );
}

// ----- plain (non-undoable) creates -----

export const createTask = (listId: string, title: string) =>
  useTaskStore.getState().create(listId, title);

export const createSubtask = (parentId: string, title: string) =>
  useTaskStore.getState().createSubtask(parentId, title);
