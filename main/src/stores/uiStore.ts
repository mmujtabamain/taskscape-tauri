// Transient, shell-owned UI state that used to live as `useState` in App and be
// drilled through the tree. None of it persists; it's the ephemeral "what's open
// / what's mid-interaction" layer. Components subscribe to just the slice they
// need (see Toast/TrashPane for the pattern) instead of receiving it as props.
import { create } from 'zustand';
import type { DropZone } from './dragStore';

/** A one-shot request token: bumping `n` re-triggers the consumer even for the
 *  same id (e.g. pressing F2 twice on the same row). */
export interface EditRequest {
  id: string;
  n: number;
}

export interface DropTarget {
  taskId: string;
  zone: DropZone;
}

interface UiState {
  /** Row currently showing its inline subtask composer. */
  composeFor: string | null;
  /** "Begin editing the title" signal for the inspector. */
  titleEditReq: EditRequest | null;
  /** "Open the note editor" signal for the inspector. */
  addNoteReq: EditRequest | null;
  /** The row being dragged and the live drop indicator (visual only; the id
   *  payload for a drop lives in dragStore). */
  draggingId: string | null;
  dropTarget: DropTarget | null;
  /** Shell overlays. */
  paletteOpen: boolean;
  cheatOpen: boolean;
  trashOpen: boolean;
  /** A drafted new task shown in the preview with no DB row until it gets
   *  content — the list it will land in (at most one draft at a time). */
  draftListId: string | null;

  setComposeFor: (id: string | null) => void;
  requestTitleEdit: (id: string) => void;
  clearTitleEditReq: () => void;
  requestAddNote: (id: string) => void;
  clearAddNoteReq: () => void;
  setDraggingId: (id: string | null) => void;
  setDropTarget: (t: DropTarget | null) => void;
  /** Clear both drag fields at once (dragend). */
  endDrag: () => void;
  setPaletteOpen: (open: boolean) => void;
  setCheatOpen: (open: boolean) => void;
  setTrashOpen: (open: boolean) => void;
  setDraftListId: (id: string | null) => void;
}

const bump = (r: EditRequest | null, id: string): EditRequest => ({
  id,
  n: (r?.n ?? 0) + 1,
});

export const useUiStore = create<UiState>((set) => ({
  composeFor: null,
  titleEditReq: null,
  addNoteReq: null,
  draggingId: null,
  dropTarget: null,
  paletteOpen: false,
  cheatOpen: false,
  trashOpen: false,
  draftListId: null,

  setComposeFor: (id) => set({ composeFor: id }),
  requestTitleEdit: (id) => set((s) => ({ titleEditReq: bump(s.titleEditReq, id) })),
  clearTitleEditReq: () => set({ titleEditReq: null }),
  requestAddNote: (id) => set((s) => ({ addNoteReq: bump(s.addNoteReq, id) })),
  clearAddNoteReq: () => set({ addNoteReq: null }),
  setDraggingId: (id) => set({ draggingId: id }),
  setDropTarget: (t) => set({ dropTarget: t }),
  endDrag: () => set({ draggingId: null, dropTarget: null }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setCheatOpen: (open) => set({ cheatOpen: open }),
  setTrashOpen: (open) => set({ trashOpen: open }),
  setDraftListId: (id) => set({ draftListId: id }),
}));
