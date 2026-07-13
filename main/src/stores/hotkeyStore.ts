// The effective hotkey combos by command id. Rust owns the catalog; this mirrors
// it and refreshes when the settings window reports `hotkeys-changed` (wired in
// bootstrap).
import { create } from 'zustand';
import { api } from '../api';

interface HotkeyState {
  map: Record<string, string>;
  load: () => Promise<void>;
  accel: (id: string) => string;
}

export const useHotkeyStore = create<HotkeyState>((set, get) => ({
  map: {},
  load: async () => {
    try {
      const bindings = await api.listHotkeys();
      set({ map: Object.fromEntries(bindings.map((b) => [b.id, b.accel])) });
    } catch {
      // Leave the last-known map in place on a transient failure.
    }
  },
  accel: (id) => get().map[id] ?? '',
}));
