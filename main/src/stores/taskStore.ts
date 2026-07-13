// The domain store for tasks: the flat `tasks` array plus its derived tree/index
// maps, and the primitive mutators the command layer drives (optimistic patches
// reconcile against a reload). Rust stays the source of truth — every action
// ends by either reloading or applying a change that a later `refresh` confirms.
import { create } from 'zustand';
import { api, type Task } from '../api';
import { deriveTasks, type TaskDerived } from './derive';

const EMPTY_DERIVED: TaskDerived = {
  taskById: {},
  childrenByParent: {},
  rootsByList: {},
  counts: {},
  hasPendingDesc: new Set(),
  hasDoneDesc: new Set(),
};

interface TaskState extends TaskDerived {
  tasks: Task[];
  loaded: boolean;
  load: () => Promise<void>;

  // ----- primitives the command layer uses -----
  /** Replace the whole list (used by load + full reconciles). */
  setTasks: (tasks: Task[]) => void;
  /** Optimistically patch one task's scalar fields, recomputing the derived maps. */
  patch: (id: string, partial: Partial<Task>) => void;
  /** Optimistically patch many tasks at once. */
  patchMany: (ids: string[], partial: Partial<Task>) => void;

  // ----- plain actions (reload-based; not undoable) -----
  create: (listId: string, title: string) => Promise<Task>;
  createSubtask: (parentId: string, title: string) => Promise<void>;
}

function withDerived(tasks: Task[]): { tasks: Task[] } & TaskDerived {
  return { tasks, ...deriveTasks(tasks) };
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loaded: false,
  ...EMPTY_DERIVED,

  load: async () => {
    const tasks = await api.allTasks();
    set({ ...withDerived(tasks), loaded: true });
  },

  setTasks: (tasks) => set(withDerived(tasks)),

  patch: (id, partial) =>
    set((s) =>
      withDerived(s.tasks.map((t) => (t.id === id ? { ...t, ...partial } : t)))
    ),

  patchMany: (ids, partial) => {
    const idset = new Set(ids);
    set((s) =>
      withDerived(
        s.tasks.map((t) => (idset.has(t.id) ? { ...t, ...partial } : t))
      )
    );
  },

  create: async (listId, title) => {
    const task = await api.createTask(listId, title);
    await get().load();
    return task;
  },

  createSubtask: async (parentId, title) => {
    const parent = get().taskById[parentId];
    if (!parent) return;
    await api.createTask(parent.list_id, title, undefined, parentId);
    await get().load();
  },
}));
