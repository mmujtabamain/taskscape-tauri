// Pane geometry + view chrome: which list each of the two panes shows, which
// pane is focused, the preview panel, split ratio, and the collapsed set. Owns
// the localStorage mirrors and the `last_active_list` persistence (it writes the
// FOCUSED list, so tray captures land where the user is actually working).
import { create } from 'zustand';
import { api } from '../api';

const num = (key: string, fallback: number) =>
  Number(localStorage.getItem(key)) || fallback;

interface LayoutState {
  activeListId: string | null;
  splitListId: string | null;
  paneFocus: string | null;
  previewOpen: boolean;
  previewW: number;
  splitRatio: number;
  collapsed: Set<string>;

  focusedListId: () => string | null;

  setActiveList: (id: string | null) => void;
  selectList: (id: string) => void;
  toggleSplit: (id: string) => void;
  closeSplit: () => void;
  swapPanes: () => void;
  setPaneFocus: (id: string) => void;
  /** After a project switch: show `firstListId` on the left, clear the split. */
  resetForProject: (firstListId: string | null) => void;

  setPreviewOpen: (open: boolean) => void;
  togglePreview: () => void;
  setPreviewW: (w: number) => void;
  setSplitRatio: (r: number) => void;
  resetSplitRatio: () => void;

  toggleCollapsed: (id: string) => void;
  setCollapsed: (ids: Set<string>) => void;
}

/** The focused list is whichever visible pane the user last worked in, falling
 *  back to the left pane when `paneFocus` points off-screen. Pure so both the
 *  selector and the persistence path agree. */
function focusedOf(s: {
  paneFocus: string | null;
  activeListId: string | null;
  splitListId: string | null;
}): string | null {
  return s.paneFocus != null &&
    (s.paneFocus === s.activeListId || s.paneFocus === s.splitListId)
    ? s.paneFocus
    : s.activeListId;
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  // Persist the focused list whenever it changes, so a relaunch (and the tray)
  // restore it. Called after any focus/pane mutation.
  const persistFocus = () => {
    const id = focusedOf(get());
    if (id) api.setActiveList(id).catch(() => {});
  };

  return {
    activeListId: null,
    splitListId: localStorage.getItem('ui.split') || null,
    paneFocus: null,
    previewOpen: localStorage.getItem('ui.preview') !== '0',
    previewW: num('ui.previewW', 320),
    splitRatio: num('ui.splitRatio', 0.5),
    collapsed: new Set(),

    focusedListId: () => focusedOf(get()),

    setActiveList: (id) => {
      set({ activeListId: id });
      persistFocus();
    },

    // Each pane is independent and panes never swap sides: clicking a tab already
    // shown just focuses that pane; any other tab loads into the focused pane.
    selectList: (id) => {
      const { activeListId, splitListId } = get();
      if (id === activeListId || id === splitListId) {
        set({ paneFocus: id });
      } else if (splitListId != null && focusedOf(get()) === splitListId) {
        set({ splitListId: id, paneFocus: id });
        localStorage.setItem('ui.split', id);
      } else {
        set({ activeListId: id, paneFocus: id });
      }
      persistFocus();
    },

    toggleSplit: (id) =>
      set((s) => {
        const next = s.splitListId === id ? null : id === s.activeListId ? s.splitListId : id;
        if (next) localStorage.setItem('ui.split', next);
        else localStorage.removeItem('ui.split');
        return { splitListId: next };
      }),

    closeSplit: () => {
      localStorage.removeItem('ui.split');
      set({ splitListId: null });
    },

    swapPanes: () =>
      set((s) => {
        if (s.splitListId == null) return s;
        localStorage.setItem('ui.split', s.activeListId ?? '');
        return {
          activeListId: s.splitListId,
          splitListId: s.activeListId,
          splitRatio: 1 - s.splitRatio,
        };
      }),

    setPaneFocus: (id) => {
      set({ paneFocus: id });
      persistFocus();
    },

    resetForProject: (firstListId) => {
      localStorage.removeItem('ui.split');
      set({ activeListId: firstListId, splitListId: null, paneFocus: firstListId });
      persistFocus();
    },

    setPreviewOpen: (open) => {
      localStorage.setItem('ui.preview', open ? '1' : '0');
      set({ previewOpen: open });
    },
    togglePreview: () => get().setPreviewOpen(!get().previewOpen),
    setPreviewW: (w) => {
      localStorage.setItem('ui.previewW', String(w));
      set({ previewW: w });
    },
    setSplitRatio: (r) => {
      localStorage.setItem('ui.splitRatio', String(r));
      set({ splitRatio: r });
    },
    resetSplitRatio: () => get().setSplitRatio(0.5),

    toggleCollapsed: (id) =>
      set((s) => {
        const next = new Set(s.collapsed);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { collapsed: next };
      }),
    setCollapsed: (ids) => set({ collapsed: ids }),
  };
});
