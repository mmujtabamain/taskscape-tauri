// App-wide user settings that the UI reads widely. Backed by the Rust settings
// store (now a JSON file) via api.get/setSetting. Reduced-motion and theme have
// their own dedicated infra (lib/reducedMotion, lib/theme); this holds the rest.
import { create } from 'zustand';
import { api } from '../api';

interface SettingsState {
  showCompleted: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setShowCompleted: (show: boolean) => void;
  toggleShowCompleted: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  showCompleted: true,
  loaded: false,

  load: async () => {
    const showDone = await api.getSetting('show_completed');
    set({ showCompleted: showDone !== '0', loaded: true });
  },

  setShowCompleted: (show) => {
    set({ showCompleted: show });
    api.setSetting('show_completed', show ? '1' : '0').catch(() => {});
  },

  toggleShowCompleted: () => get().setShowCompleted(!get().showCompleted),
}));
