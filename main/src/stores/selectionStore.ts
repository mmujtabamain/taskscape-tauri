// Selection lives here: `selectedTaskId` (the active/previewed member) and a
// per-pane ambient multi-selection. Actions take the pane's visual order where a
// range needs it (the caller derives it from `flattenVisible`), keeping this
// store free of task/layout deps.
import { create } from 'zustand';
import { rangeBetween } from '../lib/selection';

export interface PaneSel {
  ids: Set<string>;
  anchor: string | null;
}

const EMPTY: PaneSel = { ids: new Set(), anchor: null };

export interface ClickMods {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

interface SelectionState {
  selectedTaskId: string | null;
  byPane: Record<string, PaneSel>;

  paneSel: (paneId: string) => PaneSel;
  focus: (id: string | null) => void;

  /** A row was clicked: plain = preview + reset; ⌘ = toggle; ⇧ = range. */
  rowClick: (paneId: string, id: string, mods: ClickMods, order: string[]) => void;
  toggle: (paneId: string, id: string) => void;
  selectAll: (paneId: string, ids: string[]) => void;
  setPane: (paneId: string, ids: Set<string>, anchor: string | null) => void;
  clear: (paneId: string) => void;
  clearAll: () => void;
  /** Drop ids/anchors for tasks that no longer exist (after a reload). */
  pruneToAlive: (alive: Set<string>) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedTaskId: null,
  byPane: {},

  paneSel: (paneId) => get().byPane[paneId] ?? EMPTY,
  focus: (id) => set({ selectedTaskId: id }),

  rowClick: (paneId, id, mods, order) => {
    const cur = get().paneSel(paneId);
    let next: PaneSel;
    if (mods.metaKey || mods.ctrlKey) {
      const ids = new Set(cur.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      next = { ids, anchor: id };
    } else if (mods.shiftKey && (cur.anchor || get().selectedTaskId)) {
      const anchor = cur.anchor ?? get().selectedTaskId!;
      next = { ids: new Set(rangeBetween(order, anchor, id)), anchor };
    } else {
      // Plain click previews one row and drops the bulk selection (anchor kept
      // for a following ⇧-range).
      next = { ids: new Set(), anchor: id };
    }
    set((s) => ({ selectedTaskId: id, byPane: { ...s.byPane, [paneId]: next } }));
  },

  toggle: (paneId, id) => {
    const ids = new Set(get().paneSel(paneId).ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    set((s) => ({
      selectedTaskId: id,
      byPane: { ...s.byPane, [paneId]: { ids, anchor: id } },
    }));
  },

  selectAll: (paneId, ids) => {
    if (ids.length === 0) return;
    set((s) => ({
      byPane: {
        ...s.byPane,
        [paneId]: { ids: new Set(ids), anchor: s.selectedTaskId ?? ids[0] },
      },
    }));
  },

  setPane: (paneId, ids, anchor) =>
    set((s) => ({ byPane: { ...s.byPane, [paneId]: { ids, anchor } } })),

  clear: (paneId) =>
    set((s) => {
      if (!s.byPane[paneId]) return s;
      const byPane = { ...s.byPane };
      delete byPane[paneId];
      return { byPane };
    }),

  clearAll: () => set({ byPane: {} }),

  pruneToAlive: (alive) =>
    set((s) => {
      const byPane: Record<string, PaneSel> = {};
      let changed = false;
      for (const [key, v] of Object.entries(s.byPane)) {
        const ids = new Set([...v.ids].filter((id) => alive.has(id)));
        const anchor = v.anchor && alive.has(v.anchor) ? v.anchor : null;
        if (ids.size !== v.ids.size || anchor !== v.anchor) changed = true;
        if (ids.size > 0 || anchor) byPane[key] = { ids, anchor };
        else changed = true;
      }
      const selectedTaskId =
        s.selectedTaskId && alive.has(s.selectedTaskId) ? s.selectedTaskId : null;
      if (selectedTaskId !== s.selectedTaskId) changed = true;
      return changed ? { byPane, selectedTaskId } : s;
    }),
}));
