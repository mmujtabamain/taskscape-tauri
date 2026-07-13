// Per-pane view options (D.1): how each pane sorts and filters its tasks. This
// is display-only — it never rewrites stored sort_order; "manual" is the stored
// order. The richer filters (direction, content, created-date) are edited in the
// standalone `overlay` filter window and pushed back here per pane.
import { create } from 'zustand';

export type SortMode = 'manual' | 'created' | 'alpha' | 'done-last';
export type SortDir = 'asc' | 'desc';
export type FilterMode = 'all' | 'active' | 'completed';
export type CreatedRange = 'any' | 'today' | 'week' | 'month';

export interface PaneView {
  sort: SortMode;
  dir: SortDir;
  filter: FilterMode;
  hasNotes: boolean;
  hasAttachments: boolean;
  hasSubtasks: boolean;
  created: CreatedRange;
}

export const DEFAULT_VIEW: PaneView = {
  sort: 'manual',
  dir: 'asc',
  filter: 'all',
  hasNotes: false,
  hasAttachments: false,
  hasSubtasks: false,
  created: 'any',
};

/** Whether a pane's view differs from the defaults — drives the footer's lit
 *  state and the "active" badge. */
export function isViewActive(v: PaneView): boolean {
  return (
    v.sort !== 'manual' ||
    v.dir !== 'asc' ||
    v.filter !== 'all' ||
    v.hasNotes ||
    v.hasAttachments ||
    v.hasSubtasks ||
    v.created !== 'any'
  );
}

interface ViewState {
  byPane: Record<string, PaneView>;
  get: (paneId: string) => PaneView;
  /** Replace a pane's whole view (the overlay window sends the full object). */
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
