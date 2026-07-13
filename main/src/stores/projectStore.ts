// Projects + which one is active. A brand-new database has no projects, so
// `load` seeds a default one so lists have a home (mirrors the old App logic).
import { create } from 'zustand';
import { api, type Project } from '../api';
import { useListStore } from './listStore';
import { useTaskStore } from './taskStore';

interface ProjectState {
  projects: Project[];
  activeId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  setActive: (id: string | null) => void;

  create: (name: string) => Promise<Project>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeId: null,
  loaded: false,

  load: async () => {
    let projects = await api.listProjects();
    if (projects.length === 0) projects = [await api.defaultProject()];
    // Keep the current active project if it still exists, else fall back to the
    // persisted one, else the first project.
    const cur = get().activeId;
    const persisted = await api.getSetting('last_active_project');
    const activeId =
      cur && projects.some((p) => p.id === cur)
        ? cur
        : persisted && projects.some((p) => p.id === persisted)
          ? persisted
          : (projects[0]?.id ?? null);
    set({ projects, activeId, loaded: true });
  },

  setActive: (id) => {
    set({ activeId: id });
    if (id) api.setActiveProject(id).catch(() => {});
  },

  create: async (name) => {
    const project = await api.createProject(name);
    set({ activeId: project.id });
    await Promise.all([get().load(), useListStore.getState().load()]);
    return project;
  },

  rename: async (id, name) => {
    await api.renameProject(id, name);
    await get().load();
  },

  remove: async (id) => {
    await api.deleteProject(id);
    if (id === get().activeId) set({ activeId: null });
    await Promise.all([
      get().load(),
      useListStore.getState().load(),
      useTaskStore.getState().load(),
    ]);
  },
}));
