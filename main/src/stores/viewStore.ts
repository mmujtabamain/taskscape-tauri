// Per-pane view options (D.1): how each pane sorts and filters its tasks. This
// is display-only — it never rewrites stored sort_order; "manual" is the stored
// order. The FilterPanel (hosted in the preview panel) edits whichever pane(s)
// are currently visible — while split it writes the same view to both panes.
import { create } from 'zustand';

export type SortMode = 'manual' | 'created' | 'updated' | 'alpha' | 'done-last';
export type SortDir = 'asc' | 'desc';
export type FilterMode = 'all' | 'active' | 'completed';
/** Content predicate: don't care / must have / must not have. */
export type TriState = 'any' | 'has' | 'none';
export type DateField = 'created' | 'updated';
export type DateRange = 'any' | 'day' | 'week' | 'month' | 'custom';

export interface PaneView {
  sort: SortMode;
  dir: SortDir;
  filter: FilterMode;
  notes: TriState;
  attachments: TriState;
  subtasks: TriState;
  dateField: DateField;
  dateRange: DateRange;
  /** Rolling window in days, used when `dateRange` is 'custom'. */
  customDays: number;
}

export const DEFAULT_VIEW: PaneView = {
  sort: 'manual',
  dir: 'asc',
  filter: 'all',
  notes: 'any',
  attachments: 'any',
  subtasks: 'any',
  dateField: 'created',
  dateRange: 'any',
  customDays: 7,
};

/** Whether a pane's view differs from the defaults — drives the footer's lit
 *  state and the panel's Reset/summary. `dateField` and `customDays` alone
 *  don't count: they only matter once a range is on. */
export function isViewActive(v: PaneView): boolean {
  return (
    v.sort !== 'manual' ||
    v.dir !== 'asc' ||
    v.filter !== 'all' ||
    v.notes !== 'any' ||
    v.attachments !== 'any' ||
    v.subtasks !== 'any' ||
    v.dateRange !== 'any'
  );
}

interface ViewState {
  byPane: Record<string, PaneView>;
  get: (paneId: string) => PaneView;
  /** Replace a pane's whole view with a full object. */
  set: (paneId: string, view: PaneView) => void;
  /** Merge a partial view (used by quick toggles). */
  patch: (paneId: string, partial: Partial<PaneView>) => void;
  reset: (paneId: string) => void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  byPane: {},
  get: (paneId) => get().byPane[paneId] ?? DEFAULT_VIEW,
  set: (paneId, view) =>
    set((s) => ({ byPane: { ...s.byPane, [paneId]: view } })),
  patch: (paneId, partial) =>
    set((s) => ({
      byPane: {
        ...s.byPane,
        [paneId]: { ...(s.byPane[paneId] ?? DEFAULT_VIEW), ...partial },
      },
    })),
  reset: (paneId) =>
    set((s) => {
      if (!s.byPane[paneId]) return s;
      const byPane = { ...s.byPane };
      delete byPane[paneId];
      return { byPane };
    }),
}));
