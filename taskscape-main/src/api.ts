import { invoke } from "@tauri-apps/api/core";

export type LinkType = "reference" | "copy";

export interface Project {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface List {
  id: string;
  project_id: string;
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
  parent_id: string | null;
  title: string;
  notes: string | null;
  done: boolean;
  created_at: number;
  updated_at: number;
  attachments: Attachment[];
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  done?: boolean;
}

export const api = {
  // projects
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (name: string) => invoke<Project>("create_project", { name }),
  renameProject: (id: string, name: string) => invoke<void>("rename_project", { id, name }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  defaultProject: () => invoke<Project>("default_project"),

  // lists
  listLists: () => invoke<List[]>("list_lists"),
  createList: (projectId: string, name: string) =>
    invoke<List>("create_list", { projectId, name }),
  renameList: (id: string, name: string) => invoke<void>("rename_list", { id, name }),
  deleteList: (id: string) => invoke<void>("delete_list", { id }),

  // tasks
  listTasks: (listId: string) => invoke<Task[]>("list_tasks", { listId }),
  allTasks: () => invoke<Task[]>("all_tasks"),
  createTask: (listId: string, title: string, notes?: string, parentId?: string) =>
    invoke<Task>("create_task", {
      listId,
      title,
      notes: notes ?? null,
      parentId: parentId ?? null,
    }),
  updateTask: (id: string, patch: TaskPatch) => invoke<Task>("update_task", { id, ...patch }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),

  // app state
  setActiveList: (id: string) => invoke<void>("set_active_list", { id }),
  setActiveProject: (id: string) => invoke<void>("set_active_project", { id }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),

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
