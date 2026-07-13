// A single transient toast with an optional action (e.g. "3 moved to Trash ·
// Undo"). Auto-dismisses; a new toast replaces the current one.
import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
}

interface ToastState {
  toast: Toast | null;
  show: (message: string, actionLabel?: string, action?: () => void) => void;
  dismiss: () => void;
}

let timer: number | undefined;
let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (message, actionLabel, action) => {
    window.clearTimeout(timer);
    set({ toast: { id: ++seq, message, actionLabel, action } });
    timer = window.setTimeout(() => set({ toast: null }), 6000);
  },
  dismiss: () => {
    window.clearTimeout(timer);
    set({ toast: null });
  },
}));
