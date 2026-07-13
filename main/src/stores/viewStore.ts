// Per-pane view options (D.1): how each pane sorts and filters its tasks. This
// is display-only — it never rewrites stored sort_order; "manual" is the stored
// order.
import { create } from 'zustand';

export type SortMode = 'manual' | 'created' | 'alpha' | 'done-last';
export type FilterMode = 'all' | 'active' | 'completed';

export interface PaneView {
  sort: SortMode;
  filter: FilterMode;
}

export const DEFAULT_VIEW: PaneView = { sort: 'manual', filter: 'all' };

interface ViewState {
  byPane: Record<string, PaneView>;
  get: (paneId: string) => PaneView;
  setSort: (paneId: string, sort: SortMode) => void;
  setFilter: (paneId: string, filter: FilterMode) => void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  byPane: {},
  get: (paneId) => get().byPane[paneId] ?? DEFAULT_VIEW,
  setSort: (paneId, sort) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? DEFAULT_VIEW), sort } },
    })),
  setFilter: (paneId, filter) =>
    set((s) => ({
      byPane: { ...s.byPane, [paneId]: { ...(s.byPane[paneId] ?? DEFAULT_VIEW), filter } },
    })),
}));
