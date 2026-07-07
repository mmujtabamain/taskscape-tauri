import { invoke } from "@tauri-apps/api/core";

export type LinkType = "reference" | "copy";

export interface List {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface Attachment {
  id: string;
  task_id: string;
  name: string;
  link_type: LinkType;
  location: string;
  created_at: number;
}

export interface Task {
  id: string;
  list_id: string;
  title: string;
  notes: string | null;
  done: boolean;
  created_at: number;
  updated_at: number;
  due_at: number | null;
  attachments: Attachment[];
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  done?: boolean;
}

export const api = {
  // lists
  listLists: () => invoke<List[]>("list_lists"),
  createList: (name: string) => invoke<List>("create_list", { name }),
  renameList: (id: string, name: string) => invoke<void>("rename_list", { id, name }),
  deleteList: (id: string) => invoke<void>("delete_list", { id }),

  // tasks
  listTasks: (listId: string) => invoke<Task[]>("list_tasks", { listId }),
  allTasks: () => invoke<Task[]>("all_tasks"),
  createTask: (listId: string, title: string, notes?: string) =>
    invoke<Task>("create_task", { listId, title, notes: notes ?? null }),
  updateTask: (id: string, patch: TaskPatch) => invoke<Task>("update_task", { id, ...patch }),
  setTaskDue: (id: string, due: number | null) => invoke<Task>("set_task_due", { id, due }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),

  // app state
  setActiveList: (id: string) => invoke<void>("set_active_list", { id }),

  // attachments
  listAttachments: (taskId: string) => invoke<Attachment[]>("list_attachments", { taskId }),
  addReference: (taskId: string, name: string, location: string) =>
    invoke<Attachment>("add_reference", { taskId, name, location }),
  addCopy: (taskId: string, sourcePath: string, name?: string) =>
    invoke<Attachment>("add_copy", { taskId, sourcePath, name: name ?? null }),
  deleteAttachment: (id: string) => invoke<void>("delete_attachment", { id }),
  openAttachment: (a: Attachment) =>
    invoke<void>("open_attachment", { linkType: a.link_type, location: a.location }),
};
