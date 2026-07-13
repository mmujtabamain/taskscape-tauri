// Lists across all projects (the flat source array); `listsInProject` filters by
// the active project. List CRUD + reorder live here.
import { create } from 'zustand';
import { api, type List } from '../api';
import { useTaskStore } from './taskStore';

interface ListState {
  lists: List[];
  loaded: boolean;
  load: () => Promise<void>;
  listsInProject: (projectId: string | null) => List[];

  create: (projectId: string, name: string) => Promise<List>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (draggedId: string, targetId: string, before: boolean) => Promise<void>;
}

export const useListStore = create<ListState>((set, get) => ({
  lists: [],
  loaded: false,

  load: async () => {
    set({ lists: await api.listLists(), loaded: true });
  },

  listsInProject: (projectId) =>
    get().lists.filter((l) => l.project_id === projectId),

  create: async (projectId, name) => {
    const list = await api.createList(projectId, name);
    await get().load();
    return list;
  },

  rename: async (id, name) => {
    await api.renameList(id, name);
    await get().load();
  },

  remove: async (id) => {
    await api.deleteList(id);
    await Promise.all([get().load(), useTaskStore.getState().load()]);
  },

  // Rewrite every tab's sort_order to evenly spaced integers in the new visual
  // order — lists are few, so a full rebuild is cheap and collision-free.
  reorder: async (draggedId, targetId, before) => {
    const project = get().lists.find((l) => l.id === draggedId)?.project_id;
    const inProject = get().lists.filter((l) => l.project_id === project);
    const dragged = inProject.find((l) => l.id === draggedId);
    const rest = inProject.filter((l) => l.id !== draggedId);
    const targetIdx = rest.findIndex((l) => l.id === targetId);
    if (!dragged || targetIdx < 0) return;
    const insertIdx = before ? targetIdx : targetIdx + 1;
    const ordered = [
      ...rest.slice(0, insertIdx),
      dragged,
      ...rest.slice(insertIdx),
    ];
    await Promise.all(
      ordered.map((l, i) => api.reorderList(l.id, (i + 1) * 1000))
    );
    await get().load();
  },
}));
