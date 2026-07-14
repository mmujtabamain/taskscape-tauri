// Cross-store view derivations: whether a task shows in a given pane, and the
// pane's tasks flattened into visual order. A "pane" is identified by the list
// id it shows. These read several stores' current state (not hooks), so they
// suit event handlers, selection ranges, and per-render filtering alike.
import type { Task } from '../api';
import { effSort } from './derive';
import { useLayoutStore } from './layoutStore';
import { useProjectStore } from './projectStore';
import { matchSet } from './searchStore';
import { useSearchStore } from './searchStore';
import { useSettingsStore } from './settingsStore';
import { useTaskStore } from './taskStore';
import {
  useViewStore,
  type CreatedRange,
  type SortDir,
  type SortMode,
} from './viewStore';

/** The active search match set for a pane (matches + ancestors), or null when
 *  the pane isn't searching. */
export function paneSearchSet(paneId: string): Set<string> | null {
  const s = useSearchStore.getState().get(paneId);
  if (!s.query.trim()) return null;
  return matchSet(
    s.query,
    s.scope,
    s.fields,
    paneId,
    useProjectStore.getState().activeId
  );
}

export function paneSearching(paneId: string): boolean {
  const s = useSearchStore.getState().get(paneId);
  return s.query.trim().length > 0;
}

// ----- refine filters (content + created-date), with subtree-keep ------------

let refineCacheTasks: Task[] | null = null;
const refineCache = new Map<string, Set<string>>();

const hasNotesOf = (t: Task): boolean =>
  (t.note_items?.length ?? 0) > 0 || !!t.notes?.trim();

function createdCutoff(range: CreatedRange): number | null {
  if (range === 'any') return null;
  const DAY = 86_400_000;
  const now = Date.now();
  if (range === 'today') return now - DAY;
  if (range === 'week') return now - 7 * DAY;
  return now - 30 * DAY; // month
}

/** The set of tasks a pane's content/created filters admit — a task passes if it
 *  matches every enabled toggle, OR any descendant does (so ancestors stay to
 *  keep the tree reachable). Returns null when no refine filter is on. Memoized
 *  on (tasks identity, pane's refine signature). */
export function refineSet(paneId: string): Set<string> | null {
  const v = useViewStore.getState().get(paneId);
  const on =
    v.hasNotes || v.hasAttachments || v.hasSubtasks || v.created !== 'any';
  if (!on) return null;

  const { tasks, childrenByParent, rootsByList } = useTaskStore.getState();
  if (tasks !== refineCacheTasks) {
    refineCache.clear();
    refineCacheTasks = tasks;
  }
  const key = `${paneId}|${v.hasNotes}|${v.hasAttachments}|${v.hasSubtasks}|${v.created}`;
  const cached = refineCache.get(key);
  if (cached) return cached;

  const cutoff = createdCutoff(v.created);
  const selfPass = (t: Task): boolean => {
    if (v.hasNotes && !hasNotesOf(t)) return false;
    if (v.hasAttachments && t.attachments.length === 0) return false;
    if (v.hasSubtasks && (childrenByParent[t.id]?.length ?? 0) === 0) return false;
    if (cutoff != null && t.created_at < cutoff) return false;
    return true;
  };
  const set = new Set<string>();
  const visit = (t: Task): boolean => {
    let anyChild = false;
    for (const c of childrenByParent[t.id] ?? []) if (visit(c)) anyChild = true;
    const include = selfPass(t) || anyChild;
    if (include) set.add(t.id);
    return include;
  };
  for (const r of rootsByList[paneId] ?? []) visit(r);
  refineCache.set(key, set);
  return set;
}

/** Does this task show in this pane? Combines the pane's search set, its
 *  content/created refine filters, the active/completed filter, and the global
 *  show-completed setting. */
export function isVisibleInPane(task: Task, paneId: string): boolean {
  const search = paneSearchSet(paneId);
  if (search && !search.has(task.id)) return false;

  const refine = refineSet(paneId);
  if (refine && !refine.has(task.id)) return false;

  const { hasPendingDesc, hasDoneDesc } = useTaskStore.getState();
  const filter = useViewStore.getState().get(paneId).filter;
  if (filter === 'active') return !task.done || hasPendingDesc.has(task.id);
  if (filter === 'completed') return task.done || hasDoneDesc.has(task.id);
  // 'all' defers to the global show-completed toggle.
  if (useSettingsStore.getState().showCompleted) return true;
  return !task.done || hasPendingDesc.has(task.id);
}

function comparator(sort: SortMode, dir: SortDir): (a: Task, b: Task) => number {
  const base: (a: Task, b: Task) => number = (() => {
    switch (sort) {
      case 'created':
        return (a: Task, b: Task) => a.created_at - b.created_at;
      case 'alpha':
        return (a: Task, b: Task) => a.title.localeCompare(b.title);
      case 'done-last':
        return (a: Task, b: Task) =>
          Number(a.done) - Number(b.done) || effSort(a) - effSort(b);
      default:
        return (a: Task, b: Task) => effSort(a) - effSort(b);
    }
  })();
  return dir === 'desc' ? (a, b) => -base(a, b) : base;
}

/** Order a set of siblings by the pane's sort + direction, for rendering. The
 *  input is treated as read-only (a fresh array is returned when a sort is
 *  needed); "manual" ascending is already the stored order, so it passes
 *  through untouched. */
export function orderForPane(paneId: string, tasks: Task[]): Task[] {
  const v = useViewStore.getState().get(paneId);
  if (v.sort === 'manual' && v.dir === 'asc') return tasks;
  return [...tasks].sort(comparator(v.sort, v.dir));
}

/** The pane's tasks in visual order (respecting collapse, search, filter, and
 *  the pane's sort). The axis for arrow-nav, ⇧-range selection, and multi-drag. */
export function flattenVisible(paneId: string): Task[] {
  const { rootsByList, childrenByParent } = useTaskStore.getState();
  const collapsed = useLayoutStore.getState().collapsed;
  const v = useViewStore.getState().get(paneId);
  const searching = paneSearching(paneId);
  const cmp = comparator(v.sort, v.dir);

  const sortedVisible = (arr: Task[]) =>
    arr.filter((t) => isVisibleInPane(t, paneId)).sort(cmp);

  const out: Task[] = [];
  const walk = (t: Task) => {
    out.push(t);
    if (searching || !collapsed.has(t.id))
      for (const c of sortedVisible(childrenByParent[t.id] ?? [])) walk(c);
  };
  for (const r of sortedVisible(rootsByList[paneId] ?? [])) walk(r);
  return out;
}
