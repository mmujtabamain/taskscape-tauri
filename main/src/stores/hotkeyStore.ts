// The effective hotkey combos by command id. Rust owns the catalog; this mirrors
// it and refreshes when the settings window reports `hotkeys-changed` (wired in
// bootstrap).
import { bindingsToMap, type Accel } from '@taskscape/common-ui/hotkeys';
import { create } from 'zustand';
import { api } from '../api';

interface HotkeyState {
  map: Record<string, Accel>;
  load: () => Promise<void>;
  accel: (id: string) => Accel;
}

export const useHotkeyStore = create<HotkeyState>((set, get) => ({
  map: {},
  load: async () => {
    try {
      set({ map: bindingsToMap(await api.listHotkeys()) });
    } catch {
      // Leave the last-known map in place on a transient failure.
    }
  },
  accel: (id) => get().map[id] ?? '',
}));
