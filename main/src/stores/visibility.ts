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
import { useViewStore, type SortMode } from './viewStore';

/** The active search match set for a pane (matches + ancestors), or null when
 *  the pane isn't searching. */
export function paneSearchSet(paneId: string): Set<string> | null {
  const s = useSearchStore.getState().get(paneId);
  if (!s.active || !s.query.trim()) return null;
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
  return s.active && s.query.trim().length > 0;
}

/** Does this task show in this pane? Combines the pane's search set, the pane's
 *  active/completed filter, and the global show-completed setting. */
export function isVisibleInPane(task: Task, paneId: string): boolean {
  const search = paneSearchSet(paneId);
  if (search && !search.has(task.id)) return false;

  const { hasPendingDesc, hasDoneDesc } = useTaskStore.getState();
  const filter = useViewStore.getState().get(paneId).filter;
  if (filter === 'active') return !task.done || hasPendingDesc.has(task.id);
  if (filter === 'completed') return task.done || hasDoneDesc.has(task.id);
  // 'all' defers to the global show-completed toggle.
  if (useSettingsStore.getState().showCompleted) return true;
  return !task.done || hasPendingDesc.has(task.id);
}

function comparator(sort: SortMode): (a: Task, b: Task) => number {
  switch (sort) {
    case 'created':
      return (a, b) => a.created_at - b.created_at;
    case 'alpha':
      return (a, b) => a.title.localeCompare(b.title);
    case 'done-last':
      return (a, b) => Number(a.done) - Number(b.done) || effSort(a) - effSort(b);
    default:
      return (a, b) => effSort(a) - effSort(b);
  }
}

/** The pane's tasks in visual order (respecting collapse, search, filter, and
 *  the pane's sort). The axis for arrow-nav, ⇧-range selection, and multi-drag. */
export function flattenVisible(paneId: string): Task[] {
  const { rootsByList, childrenByParent } = useTaskStore.getState();
  const collapsed = useLayoutStore.getState().collapsed;
  const sort = useViewStore.getState().get(paneId).sort;
  const searching = paneSearching(paneId);
  const cmp = comparator(sort);

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
