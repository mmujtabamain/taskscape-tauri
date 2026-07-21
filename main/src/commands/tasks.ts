// Task-level commands: the lifecycle and bulk flows that used to live inline in
// App (draft new-task, delete-with-confirm + undo toast, bulk ops, keyboard
// reorder). The pure mutation math stays in stores/actions.ts; this layer adds
// the modal/toast/UI orchestration around it.
import { api, type Task, type TaskPatch } from '../api';
import { confirmModal } from '../lib/modal';
import { collapseToRoots } from '../lib/selection';
import {
  createSubtask as actCreateSubtask,
  createTask as actCreateTask,
  deleteSelection,
  deleteTasks,
  dropOnRow as actDropOnRow,
  dropSetOnRoot as actDropSetOnRoot,
  rename as actRename,
  setTasksDone as actSetTasksDone,
} from '../stores/actions';
import { useHistoryStore } from '../stores/history';
import { useLayoutStore } from '../stores/layoutStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useTaskStore } from '../stores/taskStore';
import { useToastStore } from '../stores/toastStore';
import { useUiStore } from '../stores/uiStore';
import { flattenVisible } from '../stores/visibility';

const parentOf = (id: string): string | null =>
  useTaskStore.getState().taskById[id]?.parent_id ?? null;

function subtreeSize(id: string): number {
  const { childrenByParent } = useTaskStore.getState();
  const count = (i: string): number =>
    (childrenByParent[i] ?? []).reduce((n, k) => n + 1 + count(k.id), 0);
  return count(id);
}

const showUndoToast = (message: string) =>
  useToastStore
    .getState()
    .show(message, 'Undo', () => void useHistoryStore.getState().undo());

/** Add a subtask, un-collapsing the parent so it's visible. */
export async function createSubtask(parentId: string, title: string): Promise<void> {
  const { collapsed, setCollapsed } = useLayoutStore.getState();
  if (collapsed.has(parentId)) {
    const next = new Set(collapsed);
    next.delete(parentId);
    setCollapsed(next);
  }
  await actCreateSubtask(parentId, title);
}

/** A title-only patch routes through the undoable rename; anything else writes
 *  directly and reloads. */
export function updateTask(id: string, patch: TaskPatch): Promise<void> {
  if (
    patch.title !== undefined &&
    patch.notes === undefined &&
    patch.done === undefined
  )
    return actRename(id, patch.title);
  return api.updateTask(id, patch).then(() => useTaskStore.getState().load());
}

export async function requestDeleteTask(task: Task): Promise<void> {
  const subs = subtreeSize(task.id);
  const ok = await confirmModal({
    danger: true,
    title: 'Move task to Trash?',
    message:
      `“${task.title}”` +
      (subs > 0 ? ` and its ${subs} subtask${subs === 1 ? '' : 's'}` : '') +
      ' will be moved to the Trash. You can restore it (⌘Z).',
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  await deleteTasks([task.id]);
  showUndoToast('Moved to Trash');
}

/** Focus a row, open the preview, and ask the inspector to edit its title. */
export function beginTitleEdit(id: string): void {
  useSelectionStore.getState().focus(id);
  useLayoutStore.getState().setPreviewOpen(true);
  useUiStore.getState().requestTitleEdit(id);
}

/** This pane's selection collapsed to forest roots, in visual order — the
 *  multi-drag/bulk payload. */
export function selectionRootsOf(listId: string): string[] {
  const roots = new Set(
    collapseToRoots(useSelectionStore.getState().paneSel(listId).ids, parentOf)
  );
  if (roots.size === 0) return [];
  const ordered = flattenVisible(listId)
    .map((t) => t.id)
    .filter((id) => roots.has(id));
  for (const id of roots) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

export async function bulkDelete(listId: string): Promise<void> {
  const ids = useSelectionStore.getState().paneSel(listId).ids;
  const roots = collapseToRoots(ids, parentOf);
  if (roots.length === 0) return;
  const total = roots.reduce((n, id) => n + 1 + subtreeSize(id), 0);
  const ok = await confirmModal({
    danger: true,
    title: `Move ${roots.length} task${roots.length === 1 ? '' : 's'} to Trash?`,
    message: `${total} task${total === 1 ? '' : 's'} (including subtasks) will be moved to the Trash. You can restore them (⌘Z).`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  await deleteSelection(ids);
  useSelectionStore.getState().clear(listId);
  showUndoToast(`${roots.length} moved to Trash`);
}

export async function bulkMove(listId: string, targetListId: string): Promise<void> {
  const roots = selectionRootsOf(listId);
  if (roots.length === 0) return;
  await actDropSetOnRoot(roots, targetListId);
  useSelectionStore.getState().clear(listId);
}

export function bulkSetDone(listId: string, done: boolean): void {
  void actSetTasksDone([...useSelectionStore.getState().paneSel(listId).ids], done);
}

export async function copyToClipboard(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const md = await api.copyTasks(ids);
  if (md) await navigator.clipboard.writeText(md);
}

export function bulkCopy(listId: string): void {
  void copyToClipboard([...useSelectionStore.getState().paneSel(listId).ids]);
}

// ----- draft new-task lifecycle ---------------------------------------------

/** "+" / ⌘N: open an empty draft in the preview — no DB row yet. It becomes a
 *  real task only once it gets content (see `runDraftAction`). */
export function startNewTask(listId: string): void {
  const ui = useUiStore.getState();
  useLayoutStore.getState().setPaneFocus(listId);
  useSelectionStore.getState().clear(listId);
  useSelectionStore.getState().focus(null);
  // The draft lives in the preview slot; close anything else parked there (Trash
  // or the Filter view) so it isn't created hidden behind them.
  ui.setTrashOpen(false);
  ui.setFilterOpen(false);
  useLayoutStore.getState().setPreviewOpen(true);
  ui.setDraftListId(listId);
}

// The busy guard swallows the DraftInspector's unmount blur (an extra 'commit'
// as the form tears down) so a single action can't create two rows.
let draftBusy = false;

/** The draft got content (or was dismissed). Create the DB row now, select it,
 *  and hand off to the real inspector. */
export async function runDraftAction(
  rawTitle: string,
  action: 'commit' | 'note' | 'shot' | 'cancel'
): Promise<void> {
  const ui = useUiStore.getState();
  const listId = ui.draftListId;
  if (!listId || draftBusy) return;
  if (action === 'cancel') return ui.setDraftListId(null);
  const title = rawTitle.trim();
  if (action === 'commit' && !title) return ui.setDraftListId(null);
  draftBusy = true;
  try {
    // A region capture can be cancelled — grab the shot before creating the task
    // (and before clearing the draft) so a cancel leaves the draft as-is.
    let shotPath: string | null = null;
    if (action === 'shot') {
      shotPath = await api.captureScreenshot();
      if (!shotPath) return;
    }
    ui.setDraftListId(null);
    const task = await actCreateTask(
      listId,
      action === 'commit' ? title : title || 'Untitled'
    );
    useSelectionStore.getState().focus(task.id);
    if (action === 'note') useUiStore.getState().requestAddNote(task.id);
    if (shotPath) {
      await api.addCopy(task.id, shotPath, 'screenshot.png');
      await useTaskStore.getState().load();
    }
  } finally {
    draftBusy = false;
  }
}

/** ⌘⇧Enter forwarded from the tray while the main window is frontmost: attach a
 *  screenshot to the selected task, or create an "Untitled" one for it. */
export async function attachShotHere(): Promise<void> {
  const { selectedTaskId } = useSelectionStore.getState();
  const selectedTask = selectedTaskId
    ? useTaskStore.getState().taskById[selectedTaskId]
    : null;
  if (selectedTask) {
    await api.attachScreenshot(selectedTask.id);
    await useTaskStore.getState().load();
    return;
  }
  const focusedListId = useLayoutStore.getState().focusedListId();
  if (!focusedListId) return;
  // No task yet — grab the shot first so a cancelled region capture doesn't leave
  // an empty "Untitled" task behind.
  const path = await api.captureScreenshot();
  if (!path) return;
  const created = await actCreateTask(focusedListId, 'Untitled');
  useSelectionStore.getState().focus(created.id);
  await api.addCopy(created.id, path, 'screenshot.png');
  await useTaskStore.getState().load();
}

// ----- keyboard navigation ---------------------------------------------------

/** Move the previewed task up/down among its siblings. */
export function reorderSelected(dir: -1 | 1): void {
  const { selectedTaskId } = useSelectionStore.getState();
  const { taskById, childrenByParent, rootsByList } = useTaskStore.getState();
  const t = selectedTaskId ? taskById[selectedTaskId] : null;
  if (!t) return;
  const sibs =
    (t.parent_id ? childrenByParent[t.parent_id] : rootsByList[t.list_id]) ?? [];
  const idx = sibs.findIndex((s) => s.id === t.id);
  const target = dir < 0 ? sibs[idx - 1] : sibs[idx + 1];
  if (target) void actDropOnRow(t.id, target, dir < 0 ? 'before' : 'after');
}

export function collapseAll(): void {
  useLayoutStore
    .getState()
    .setCollapsed(new Set(Object.keys(useTaskStore.getState().childrenByParent)));
}

export function expandAll(): void {
  useLayoutStore.getState().setCollapsed(new Set());
}
