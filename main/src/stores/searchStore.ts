// Per-pane inline search (C.5): each pane owns its own query/scope/fields and an
// `active` flag (the composer becomes a search field while active). One shared,
// memoized engine computes the match set, so two panes with the same query only
// tokenise once.
import { create } from 'zustand';
import type { Task } from '../api';
import { useListStore } from './listStore';
import { useTaskStore } from './taskStore';

export type SearchScope = 'list' | 'project' | 'all';
export type SearchFields = 'title' | 'notes' | 'both';

export interface PaneSearch {
  query: string;
  scope: SearchScope;
  fields: SearchFields;
  active: boolean;
}

const DEFAULT: PaneSearch = {
  query: '',
  scope: 'list',
  fields: 'both',
  active: false,
};

interface SearchState {
  byPane: Record<string, PaneSearch>;
  get: (paneId: string) => PaneSearch;
  /** True while the pane is in search mode (composer shows the search field). */
  isActive: (paneId: string) => boolean;
  /** Enter search mode (⌘F). */
  open: (paneId: string) => void;
  /** Leave search mode + clear the query (Escape). */
  close: (paneId: string) => void;
  setQuery: (paneId: string, query: string) => void;
  setScope: (paneId: string, scope: SearchScope) => void;
  setFields: (paneId: string, fields: SearchFields) => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  byPane: {},
  get: (paneId) => get().byPane[paneId] ?? DEFAULT,
  isActive: (paneId) => (get().byPane[paneId] ?? DEFAULT).active,

  open: (paneId) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? DEFAULT), active: true } },
    })),

  close: (paneId) =>
    set((s) => ({
      byPane: {
        ...s.byPane,
        [paneId]: { ...(s.byPane[paneId] ?? DEFAULT), active: false, query: '' },
      },
    })),

  setQuery: (paneId, query) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? DEFAULT), query } },
    })),

  setScope: (paneId, scope) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? DEFAULT), scope } },
    })),

  setFields: (paneId, fields) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? DEFAULT), fields } },
    })),
}));

// ----- shared search engine (memoized) -----

let cacheTasksRef: Task[] | null = null;
const cache = new Map<string, Set<string>>();

function matches(t: Task, q: string, fields: SearchFields): boolean {
  if (fields !== 'notes' && t.title.toLowerCase().includes(q)) return true;
  if (fields !== 'title' && t.notes?.toLowerCase().includes(q)) return true;
  return false;
}

/** The set of task ids matching `query` within `scope`, PLUS every match's
 *  ancestors (so the tree keeps its shape). Returns null for an empty query
 *  (meaning "no filter"). Memoized on (tasks identity, args) so identical
 *  queries across panes compute once. `contextListId`/`contextProjectId` are the
 *  pane's current list and the active project. */
export function matchSet(
  query: string,
  scope: SearchScope,
  fields: SearchFields,
  contextListId: string | null,
  contextProjectId: string | null
): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const { tasks, taskById } = useTaskStore.getState();
  if (tasks !== cacheTasksRef) {
    cache.clear();
    cacheTasksRef = tasks;
  }
  const key = `${scope}|${fields}|${contextListId}|${contextProjectId}|${q}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Restrict the candidate set by scope.
  let inScope: (t: Task) => boolean;
  if (scope === 'list') {
    inScope = (t) => t.list_id === contextListId;
  } else if (scope === 'project') {
    const listIds = new Set(
      useListStore
        .getState()
        .lists.filter((l) => l.project_id === contextProjectId)
        .map((l) => l.id)
    );
    inScope = (t) => listIds.has(t.list_id);
  } else {
    inScope = () => true;
  }

  const set = new Set<string>();
  for (const t of tasks) {
    if (!inScope(t) || !matches(t, q, fields)) continue;
    set.add(t.id);
    let p = t.parent_id;
    while (p && !set.has(p)) {
      set.add(p);
      p = taskById[p]?.parent_id ?? null;
    }
  }
  cache.set(key, set);
  return set;
}

/** Just the direct matches (no ancestors) — for match-count and next/prev
 *  cycling. Derived by re-testing; cheap relative to a keystroke. */
export function directMatches(
  query: string,
  scope: SearchScope,
  fields: SearchFields,
  contextListId: string | null,
  contextProjectId: string | null
): Set<string> {
  const q = query.trim().toLowerCase();
  const out = new Set<string>();
  if (!q) return out;
  const { tasks } = useTaskStore.getState();
  const listIds =
    scope === 'project'
      ? new Set(
          useListStore
            .getState()
            .lists.filter((l) => l.project_id === contextProjectId)
            .map((l) => l.id)
        )
      : null;
  for (const t of tasks) {
    if (scope === 'list' && t.list_id !== contextListId) continue;
    if (scope === 'project' && listIds && !listIds.has(t.list_id)) continue;
    if (matches(t, q, fields)) out.add(t.id);
  }
  return out;
}
