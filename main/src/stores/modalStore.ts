// The imperative bridge behind `openModal` (lib/modal.ts): a single-slot store
// holding the modal currently on screen. `open` returns a promise that resolves
// when the modal is answered or dismissed, so callers keep the same await-a-result
// shape they had when the modal was its own window. `ModalHost` renders whatever
// sits in `current`.
import { create } from 'zustand';
import type { ModalProps, ModalResult } from '../lib/modal';

export interface ModalRequest {
  id: string;
  props: ModalProps;
  resolve: (result: ModalResult) => void;
}

interface ModalState {
  current: ModalRequest | null;
  /** Open a modal; resolves when it's answered or dismissed. Opening one over an
   *  unanswered modal cancels the first (resolves it `{ buttonId: null }`),
   *  matching the one-at-a-time behavior the panel window had. */
  open: (props: ModalProps) => Promise<ModalResult>;
  /** Answer the modal with `id` and clear it. No-op once it's gone or a newer
   *  modal has taken its place. */
  answer: (id: string, result: ModalResult) => void;
}

export const useModalStore = create<ModalState>((set, get) => ({
  current: null,
  open: (props) =>
    new Promise<ModalResult>((resolve) => {
      get().current?.resolve({ buttonId: null });
      set({ current: { id: crypto.randomUUID().slice(0, 8), props, resolve } });
    }),
  answer: (id, result) => {
    const cur = get().current;
    if (cur?.id !== id) return;
    cur.resolve(result);
    set({ current: null });
  },
}));
