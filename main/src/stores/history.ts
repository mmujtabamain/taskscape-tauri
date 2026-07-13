// B3's undo stack. Every mutation is expressed as an invertible Command; running
// one pushes it onto `past`, ⌘Z inverts the top of `past`, ⌘⇧Z re-applies from
// `future`. Because bulk ops are commands too, undo covers them for free.
import { create } from 'zustand';

export interface Command {
  /** Human label, e.g. "Delete 3 tasks" — surfaced by the undo toast. */
  label: string;
  /** The forward op: optimistic store update + api call (rolls itself back on
   *  failure). */
  apply: () => Promise<void>;
  /** The exact inverse, for rollback AND undo. */
  invert: () => Promise<void>;
}

interface HistoryState {
  past: Command[];
  future: Command[];
  /** The most recent command (for a "N did · Undo" toast). */
  last: Command | null;
  run: (cmd: Command) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

/** Cap the stack so long sessions don't grow it unbounded. */
const MAX = 100;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  last: null,

  run: async (cmd) => {
    // apply() rolls itself back and rethrows on failure, so a throw means
    // nothing changed — don't record it.
    await cmd.apply();
    set((s) => ({
      past: [...s.past, cmd].slice(-MAX),
      future: [],
      last: cmd,
    }));
  },

  undo: async () => {
    const { past } = get();
    const cmd = past[past.length - 1];
    if (!cmd) return;
    await cmd.invert();
    set((s) => ({
      past: s.past.slice(0, -1),
      future: [...s.future, cmd],
      last: null,
    }));
  },

  redo: async () => {
    const { future } = get();
    const cmd = future[future.length - 1];
    if (!cmd) return;
    await cmd.apply();
    set((s) => ({
      past: [...s.past, cmd].slice(-MAX),
      future: s.future.slice(0, -1),
      last: cmd,
    }));
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  clear: () => set({ past: [], future: [], last: null }),
}));
