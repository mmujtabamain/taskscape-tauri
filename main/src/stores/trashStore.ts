// The Trash (soft-deleted tasks). Loads on demand; restore/purge reconcile the
// main task store so live views update immediately.
import { create } from 'zustand';
import { api, type Task } from '../api';
import { useTaskStore } from './taskStore';

interface TrashState {
  items: Task[];
  loading: boolean;
  load: () => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  purge: (ids: string[]) => Promise<void>;
  empty: () => Promise<void>;
}

export const useTrashStore = create<TrashState>((set, get) => ({
  items: [],
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      set({ items: await api.listTrashed() });
    } finally {
      set({ loading: false });
    }
  },
  restore: async (ids) => {
    await api.restoreTasks(ids);
    await Promise.all([get().load(), useTaskStore.getState().load()]);
  },
  purge: async (ids) => {
    await api.purgeTasks(ids);
    await get().load();
  },
  empty: async () => {
    await api.emptyTrash();
    await get().load();
  },
}));
