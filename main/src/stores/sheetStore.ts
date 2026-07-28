// The imperative bridge behind `openSheet` (lib/sheet.ts): a single-slot store
// holding the sheet currently on screen. `open` returns a promise that resolves
// when the sheet is answered or dismissed, so callers keep the same
// await-a-result shape they had when the question was its own window.
// `SheetHost` renders whatever sits in `current`.
import { create } from 'zustand';
import type { SheetResult, SheetSpec } from '../lib/sheet';

export interface SheetRequest {
  id: string;
  spec: SheetSpec;
  resolve: (result: SheetResult) => void;
}

interface SheetState {
  current: SheetRequest | null;
  /** Open a sheet; resolves when it's answered or dismissed. Opening one over an
   *  unanswered sheet dismisses the first, so only ever one is on screen. */
  open: (spec: SheetSpec) => Promise<SheetResult>;
  /** Answer the sheet with `id` and clear it. No-op once it's gone or a newer
   *  sheet has taken its place. */
  answer: (id: string, result: SheetResult) => void;
}

export const useSheetStore = create<SheetState>((set, get) => ({
  current: null,
  open: (spec) =>
    new Promise<SheetResult>((resolve) => {
      get().current?.resolve({ action: 'dismiss' });
      set({ current: { id: crypto.randomUUID().slice(0, 8), spec, resolve } });
    }),
  answer: (id, result) => {
    const cur = get().current;
    if (cur?.id !== id) return;
    cur.resolve(result);
    set({ current: null });
  },
}));
