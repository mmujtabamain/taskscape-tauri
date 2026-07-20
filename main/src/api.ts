import { invoke } from '@tauri-apps/api/core';
import type { HotkeyBinding } from '@taskscape/common-ui/hotkeys';
import type { Attachment, LinkType } from '@taskscape/common-ui/types';

export type { Attachment, HotkeyBinding, LinkType };

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
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface Note {
  id: string;
  task_id: string;
  /** Sanitized rich-text HTML. */
  content: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  list_id: string;
  parent_id: string | null;
  title: string;
  notes: string | null;
  done: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
  /** Set when the task is in the Trash (soft-deleted); null for a live task.
   *  Live reads never return trashed tasks — only `listTrashed` does. */
  deleted_at: number | null;
  attachments: Attachment[];
  note_items: Note[];
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  done?: boolean;
}

export const api = {
  // projects
  listProjects: () => invoke<Project[]>('list_projects'),
  createProject: (name: string) => invoke<Project>('create_project', { name }),
  renameProject: (id: string, name: string) =>
    invoke<void>('rename_project', { id, name }),
  deleteProject: (id: string) => invoke<void>('delete_project', { id }),
  defaultProject: () => invoke<Project>('default_project'),

  // lists
  listLists: () => invoke<List[]>('list_lists'),
  createList: (projectId: string, name: string) =>
    invoke<List>('create_list', { projectId, name }),
  renameList: (id: string, name: string) =>
    invoke<void>('rename_list', { id, name }),
  deleteList: (id: string) => invoke<void>('delete_list', { id }),
  reorderList: (id: string, sortOrder: number) =>
    invoke<void>('reorder_list', { id, sortOrder }),

  // tasks
  listTasks: (listId: string) => invoke<Task[]>('list_tasks', { listId }),
  allTasks: () => invoke<Task[]>('all_tasks'),
  createTask: (
    listId: string,
    title: string,
    notes?: string,
    parentId?: string
  ) =>
    invoke<Task>('create_task', {
      listId,
      title,
      notes: notes ?? null,
      parentId: parentId ?? null,
    }),
  updateTask: (id: string, patch: TaskPatch) =>
    invoke<Task>('update_task', { id, ...patch }),
  /** Soft-delete a task (to Trash); resolves with the ids stamped (for undo). */
  deleteTask: (id: string) => invoke<string[]>('delete_task', { id }),
  moveTask: (
    id: string,
    parentId: string | null,
    listId: string | null,
    sortOrder?: number
  ) =>
    invoke<Task>('move_task', {
      id,
      parentId,
      listId,
      sortOrder: sortOrder ?? null,
    }),
  reorderTask: (id: string, sortOrder: number) =>
    invoke<Task>('reorder_task', { id, sortOrder }),
  /** Soft-delete several tasks (pass the selection's forest roots; subtrees
   *  follow). Resolves with every stamped id, so the delete is undoable. */
  deleteTasks: (ids: string[]) => invoke<string[]>('delete_tasks', { ids }),
  /** Restore soft-deleted tasks (undo a delete / restore from Trash). */
  restoreTasks: (ids: string[]) => invoke<void>('restore_tasks', { ids }),
  /** Permanently remove tasks from the Trash. */
  purgeTasks: (ids: string[]) => invoke<void>('purge_tasks', { ids }),
  /** Everything currently in the Trash, most-recently-deleted first. */
  listTrashed: () => invoke<Task[]>('list_trashed'),
  /** Permanently empty the Trash. */
  emptyTrash: () => invoke<void>('empty_trash'),
  /** Mark several tasks done / not done in one call. */
  setTasksDone: (ids: string[], done: boolean) =>
    invoke<void>('set_tasks_done', { ids, done }),
  /** Render the given tasks as a Markdown checklist (the copy action). */
  copyTasks: (ids: string[]) => invoke<string>('copy_tasks', { ids }),

  // import / export (whole list, as JSON)
  exportList: (listId: string, path: string) =>
    invoke<void>('export_list', { listId, path }),
  importList: (projectId: string, path: string, name?: string) =>
    invoke<List>('import_list', { projectId, path, name: name ?? null }),

  // notes (rich-text blocks per task)
  listNotes: (taskId: string) => invoke<Note[]>('list_notes', { taskId }),
  createNote: (taskId: string, content: string) =>
    invoke<Note>('create_note', { taskId, content }),
  // Fire-and-forget: the backend enqueues the edit onto an ordered write queue
  // (autosave streams these as the user types) and returns immediately.
  updateNote: (id: string, content: string) =>
    invoke<void>('update_note', { id, content }),
  deleteNote: (id: string) => invoke<void>('delete_note', { id }),

  // app state
  setActiveList: (id: string) => invoke<void>('set_active_list', { id }),
  setActiveProject: (id: string) => invoke<void>('set_active_project', { id }),
  getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>('set_setting', { key, value }),

  // hotkeys (catalog + user bindings; conflicts are rejected by the backend)
  listHotkeys: () => invoke<HotkeyBinding[]>('list_hotkeys'),
  setHotkey: (id: string, accel: string) =>
    invoke<void>('set_hotkey', { id, accel }),
  resetHotkey: (id: string) => invoke<void>('reset_hotkey', { id }),

  // windows (settings, overlay) — each built fresh on open (props passed in at
  // build time) and destroyed on close; results/edits flow back as events.
  // (Modals aren't windows: they render in-app; see components/Modal.tsx.)
  presentWindow: (width: number, height: number) =>
    invoke<void>('present_window', { width, height }),
  openSettings: () => invoke<void>('open_settings'),
  /** Fade the main webview in once the first frame has painted (the window is
   *  already on screen with a native boot box). Idempotent. */
  revealMain: () => invoke<void>('reveal_main'),
  /** Drop the native boot box once the boot overlay is dismissed. */
  bootDone: () => invoke<void>('boot_done'),

  setWindowTheme: (dark: boolean) => invoke<void>('set_window_theme', { dark }),
  /** Whether macOS is in Low Power Mode right now (always false off macOS). */
  isLowPowerMode: () => invoke<boolean>('is_low_power_mode'),

  // attachments
  listAttachments: (taskId: string) =>
    invoke<Attachment[]>('list_attachments', { taskId }),
  addReference: (taskId: string, name: string, location: string) =>
    invoke<Attachment>('add_reference', { taskId, name, location }),
  addCopy: (taskId: string, sourcePath: string, name?: string) =>
    invoke<Attachment>('add_copy', { taskId, sourcePath, name: name ?? null }),
  attachScreenshot: (taskId: string) =>
    invoke<Attachment | null>('attach_screenshot', { taskId }),
  // Capture a screenshot (region or full-screen) without attaching it; returns
  // the PNG path, or null if a region capture was cancelled.
  captureScreenshot: () => invoke<string | null>('capture_screenshot'),
  deleteAttachment: (id: string) => invoke<void>('delete_attachment', { id }),
  renameAttachment: (id: string, name: string) =>
    invoke<Attachment>('rename_attachment', { id, name }),
  openAttachment: (a: Attachment) =>
    invoke<void>('open_attachment', {
      linkType: a.link_type,
      location: a.location,
    }),
  revealAttachment: (a: Attachment) =>
    invoke<void>('reveal_attachment', {
      linkType: a.link_type,
      location: a.location,
    }),
};
