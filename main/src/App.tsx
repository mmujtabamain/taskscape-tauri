import { formatAccel, matchesEvent } from '@taskscape/common-ui/hotkeys';
import { Spinner } from '@taskscape/common-ui/Spinner';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type List, type Project, type Task, type TaskPatch } from './api';
import { CheatSheet } from './components/CheatSheet';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenuProvider } from './components/ContextMenu';
import { PreviewPanel } from './components/PreviewPanel';
import { Toast } from './components/Toast';
import { TrashPane } from './components/TrashPane';
import { useToastStore } from './stores/toastStore';
import { TaskPane, type PaneSelection } from './components/TaskPane';
import type { BaseRowCtx, DropZone } from './components/TaskRow';
import { TitleBar } from './components/TitleBar';
import { confirmModal, promptName, promptNewList } from './lib/modal';
import { overlayOpen } from './lib/overlays';
import { collapseToRoots } from './lib/selection';
import {
  createSubtask as actCreateSubtask,
  createTask as actCreateTask,
  deleteSelection,
  deleteTasks,
  dropOnRow as actDropOnRow,
  dropSetOnRoot as actDropSetOnRoot,
  dropSetOnRow as actDropSetOnRow,
  move as actMove,
  rename as actRename,
  setTasksDone as actSetTasksDone,
  toggleDone as actToggleDone,
} from './stores/actions';
import { initialLoad, startBootstrap } from './stores/bootstrap';
import { useHistoryStore } from './stores/history';
import { useHotkeyStore } from './stores/hotkeyStore';
import { useLayoutStore } from './stores/layoutStore';
import { useListStore } from './stores/listStore';
import { useProjectStore } from './stores/projectStore';
import { useSelectionStore } from './stores/selectionStore';
import { useSettingsStore } from './stores/settingsStore';
import { useTaskStore } from './stores/taskStore';
import { flattenVisible } from './stores/visibility';
import { useViewStore, type PaneView } from './stores/viewStore';

const EMPTY_IDS: Set<string> = new Set();

function App() {
  // ----- store state -----
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeId);
  const projectsLoaded = useProjectStore((s) => s.loaded);
  const lists = useListStore((s) => s.lists);
  const taskState = useTaskStore();
  const { taskById, childrenByParent, rootsByList, counts } = taskState;
  const tasksLoaded = useTaskStore((s) => s.loaded);
  const layout = useLayoutStore();
  const selectedTaskId = useSelectionStore((s) => s.selectedTaskId);
  const selByPane = useSelectionStore((s) => s.byPane);
  const hotkeyMap = useHotkeyStore((s) => s.map);

  const ready = projectsLoaded && tasksLoaded;

  const listsInProject = useMemo(
    () => lists.filter((l) => l.project_id === activeProjectId),
    [lists, activeProjectId]
  );
  const activeList = listsInProject.find((l) => l.id === layout.activeListId) ?? null;
  const splitList = listsInProject.find((l) => l.id === layout.splitListId) ?? null;
  const focusedListId =
    layout.paneFocus != null &&
    (layout.paneFocus === layout.activeListId || layout.paneFocus === layout.splitListId)
      ? layout.paneFocus
      : layout.activeListId;
  const selectedTask = selectedTaskId ? (taskById[selectedTaskId] ?? null) : null;

  // ----- transient UI state (per-render, not domain data) -----
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const [titleEditReq, setTitleEditReq] = useState<{ id: string; n: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ taskId: string; zone: DropZone } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // A new task drafted in the preview: it has no DB row (and no list row) until it
  // gets content. `draftListId` is the list it will land in — at most one draft at
  // a time. `addNoteReq` opens the note editor on the row a draft's "Add note"
  // just created.
  const [draftListId, setDraftListId] = useState<string | null>(null);
  const [addNoteReq, setAddNoteReq] = useState<{ id: string; n: number } | null>(
    null
  );
  const searchFocusers = useRef(new Map<string, (seed?: string) => void>());

  // ----- lifecycle: one bootstrap wires events + does the first load -----
  useEffect(() => {
    const cleanup = startBootstrap();
    void initialLoad();
    return cleanup;
  }, []);

  const parentOf = useCallback(
    (id: string) => taskById[id]?.parent_id ?? null,
    [taskById]
  );

  // ----- projects -----
  const createProject = async () => {
    const name = await promptName({
      title: 'New project',
      icon: 'create_new_folder',
      suggestKind: 'project',
    });
    if (!name) return;
    await useProjectStore.getState().create(name);
  };
  const renameProject = async (project: Project) => {
    const name = await promptName({
      title: 'Rename project',
      icon: 'edit',
      initialValue: project.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === project.name) return;
    await useProjectStore.getState().rename(project.id, name);
  };
  const deleteProject = async (project: Project) => {
    const listIds = lists.filter((l) => l.project_id === project.id).map((l) => l.id);
    const taskCount = taskState.tasks.filter((t) => listIds.includes(t.list_id)).length;
    const ok = await confirmModal({
      danger: true,
      title: `Delete “${project.name}”?`,
      message: `Its ${listIds.length} list${listIds.length === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'} are deleted with it. This cannot be undone.`,
      confirmLabel: 'Delete project',
    });
    if (!ok) return;
    await useProjectStore.getState().remove(project.id);
  };
  const selectProject = (id: string) => {
    useProjectStore.getState().setActive(id);
    const first = lists.find((l) => l.project_id === id) ?? null;
    useLayoutStore.getState().resetForProject(first?.id ?? null);
    useSelectionStore.getState().focus(null);
  };

  // ----- lists (import/export + CRUD) -----
  const importList = useCallback(
    async (name?: string) => {
      const projectId = useProjectStore.getState().activeId;
      if (!projectId) return;
      const path = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (typeof path !== 'string') return;
      await api.importList(projectId, path, name);
      await Promise.all([
        useListStore.getState().load(),
        useTaskStore.getState().load(),
      ]);
    },
    []
  );
  const exportList = useCallback(async (list: List) => {
    const path = await save({
      defaultPath: `${list.name}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    await api.exportList(list.id, path);
  }, []);
  const createList = async () => {
    const projectId = useProjectStore.getState().activeId;
    if (!projectId) return;
    const res = await promptNewList();
    if (!res) return;
    if (res.action === 'import') return importList();
    const list = await useListStore.getState().create(projectId, res.name);
    useLayoutStore.getState().selectList(list.id);
  };
  const renameList = async (list: List) => {
    const name = await promptName({
      title: 'Rename list',
      icon: 'edit',
      initialValue: list.name,
      confirmLabel: 'Rename',
      suggestKind: 'list',
    });
    if (!name || name === list.name) return;
    await useListStore.getState().rename(list.id, name);
  };
  const reorderList = (draggedId: string, targetId: string, before: boolean) =>
    useListStore.getState().reorder(draggedId, targetId, before);
  const deleteList = async (list: List) => {
    const taskCount = taskState.tasks.filter((t) => t.list_id === list.id).length;
    const ok = await confirmModal({
      danger: true,
      title: `Delete “${list.name}”?`,
      message:
        taskCount > 0
          ? `Its ${taskCount} task${taskCount === 1 ? ' is' : 's are'} deleted with it. This cannot be undone.`
          : 'The list is empty. This cannot be undone.',
      confirmLabel: 'Delete list',
    });
    if (!ok) return;
    await useListStore.getState().remove(list.id);
  };

  // ----- tasks -----
  const createSubtask = async (parentId: string, title: string) => {
    // Un-collapse the parent so the new subtask is visible.
    const { collapsed, setCollapsed } = useLayoutStore.getState();
    if (collapsed.has(parentId)) {
      const next = new Set(collapsed);
      next.delete(parentId);
      setCollapsed(next);
    }
    await actCreateSubtask(parentId, title);
  };
  const toggleDone = (task: Task) => actToggleDone(task);
  const updateTask = (id: string, patch: TaskPatch) => {
    if (patch.title !== undefined && patch.notes === undefined && patch.done === undefined)
      return actRename(id, patch.title);
    return api.updateTask(id, patch).then(() => useTaskStore.getState().load());
  };

  const subtreeSize = useCallback(
    (id: string): number => {
      const count = (i: string): number =>
        (childrenByParent[i] ?? []).reduce((n, k) => n + 1 + count(k.id), 0);
      return count(id);
    },
    [childrenByParent]
  );

  const requestDeleteTask = async (task: Task) => {
    const subs = subtreeSize(task.id);
    const ok = await confirmModal({
      danger: true,
      title: 'Move task to Trash?',
      message:
        `“${task.title}”` +
        (subs > 0 ? ` and its ${subs} subtask${subs === 1 ? '' : 's'}` : '') +
        ' will be moved to the Trash. You can restore it (⌘Z).',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await deleteTasks([task.id]);
    useToastStore
      .getState()
      .show('Moved to Trash', 'Undo', () => void useHistoryStore.getState().undo());
  };

  const beginTitleEdit = (id: string) => {
    useSelectionStore.getState().focus(id);
    useLayoutStore.getState().setPreviewOpen(true);
    setTitleEditReq((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  };
  const clearTitleEditReq = useCallback(() => setTitleEditReq(null), []);
  const clearAddNoteReq = useCallback(() => setAddNoteReq(null), []);

  // "+" / ⌘N: open an empty draft in the preview — no DB row yet. It becomes a
  // real task only once it gets content (see `runDraftAction`).
  const startNewTask = (listId: string) => {
    useLayoutStore.getState().setPaneFocus(listId);
    useSelectionStore.getState().clear(listId);
    useSelectionStore.getState().focus(null);
    useLayoutStore.getState().setPreviewOpen(true);
    setDraftListId(listId);
  };

  // The draft got content (or was dismissed). Create the DB row now — named after
  // the typed title, else "Untitled" for a note/screenshot — select it, and hand
  // off to the real inspector. 'cancel' / an empty 'commit' just drop the draft.
  // The `busy` guard swallows the DraftInspector's unmount blur (it fires an extra
  // 'commit' as the form is torn down) so a single action can't create two rows.
  const draftBusyRef = useRef(false);
  const runDraftAction = async (
    rawTitle: string,
    action: 'commit' | 'note' | 'shot' | 'cancel'
  ) => {
    const listId = draftListId;
    if (!listId || draftBusyRef.current) return;
    if (action === 'cancel') return setDraftListId(null);
    const title = rawTitle.trim();
    if (action === 'commit' && !title) return setDraftListId(null);
    draftBusyRef.current = true;
    setDraftListId(null);
    try {
      const task = await actCreateTask(
        listId,
        action === 'commit' ? title : title || 'Untitled'
      );
      useSelectionStore.getState().focus(task.id);
      if (action === 'note')
        setAddNoteReq((r) => ({ id: task.id, n: (r?.n ?? 0) + 1 }));
      if (action === 'shot') {
        await api.attachScreenshot(task.id);
        await useTaskStore.getState().load();
      }
    } finally {
      draftBusyRef.current = false;
    }
  };

  // ⌘⇧Enter forwarded from the tray while this window is frontmost: attach a
  // screenshot to the selected task, or create an "Untitled" one for it if none
  // is selected (a screenshot is content, so the row is created immediately).
  const attachShotHere = async () => {
    if (selectedTask) {
      await api.attachScreenshot(selectedTask.id);
      await useTaskStore.getState().load();
    } else if (focusedListId) {
      const created = await actCreateTask(focusedListId, 'Untitled');
      useSelectionStore.getState().focus(created.id);
      await api.attachScreenshot(created.id);
      await useTaskStore.getState().load();
    }
  };

  // The tray forwards ⌘Enter / ⌘⇧Enter here when this window is frontmost; keep
  // the handlers current (they read live selection/list) behind a stable ref.
  const routeActionsRef = useRef({ newTask: () => {}, attachShot: () => {} });
  useEffect(() => {
    routeActionsRef.current = {
      newTask: () => {
        if (focusedListId) void startNewTask(focusedListId);
      },
      attachShot: () => void attachShotHere(),
    };
  });
  useEffect(() => {
    const subs = [
      listen('new-task', () => routeActionsRef.current.newTask()),
      listen('attach-screenshot', () => routeActionsRef.current.attachShot()),
    ];
    return () => subs.forEach((s) => s.then((f) => f()));
  }, []);

  const copyToClipboard = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const md = await api.copyTasks(ids);
    if (md) await navigator.clipboard.writeText(md);
  }, []);

  // ----- per-pane selection (built from selectionStore + actions) -----
  const selectionRootsOf = (listId: string): string[] => {
    const roots = new Set(
      collapseToRoots(useSelectionStore.getState().paneSel(listId).ids, parentOf)
    );
    if (roots.size === 0) return [];
    const ordered = flattenVisible(listId)
      .map((t) => t.id)
      .filter((id) => roots.has(id));
    for (const id of roots) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  };

  const bulkDelete = async (listId: string) => {
    const ids = useSelectionStore.getState().paneSel(listId).ids;
    const roots = collapseToRoots(ids, parentOf);
    if (roots.length === 0) return;
    const total = roots.reduce((n, id) => n + 1 + subtreeSize(id), 0);
    const ok = await confirmModal({
      danger: true,
      title: `Move ${roots.length} task${roots.length === 1 ? '' : 's'} to Trash?`,
      message: `${total} task${total === 1 ? '' : 's'} (including subtasks) will be moved to the Trash. You can restore them (⌘Z).`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await deleteSelection(ids);
    useSelectionStore.getState().clear(listId);
    useToastStore
      .getState()
      .show(
        `${roots.length} moved to Trash`,
        'Undo',
        () => void useHistoryStore.getState().undo()
      );
  };

  const bulkMove = async (listId: string, targetListId: string) => {
    const roots = selectionRootsOf(listId);
    if (roots.length === 0) return;
    await actDropSetOnRoot(roots, targetListId);
    useSelectionStore.getState().clear(listId);
  };

  const makeSel = (listId: string): PaneSelection => ({
    ids: selByPane[listId]?.ids ?? EMPTY_IDS,
    onRowClick: (id, mods) => {
      useLayoutStore.getState().setPaneFocus(listId);
      useSelectionStore
        .getState()
        .rowClick(listId, id, mods, flattenVisible(listId).map((t) => t.id));
    },
    onToggleSelect: (id) => {
      useLayoutStore.getState().setPaneFocus(listId);
      useSelectionStore.getState().toggle(listId, id);
    },
    selectionRoots: () => selectionRootsOf(listId),
    selectAll: () => {
      useLayoutStore.getState().setPaneFocus(listId);
      useSelectionStore
        .getState()
        .selectAll(listId, flattenVisible(listId).map((t) => t.id));
    },
    clear: () => useSelectionStore.getState().clear(listId),
    bulkSetDone: (done) =>
      void actSetTasksDone([...(selByPane[listId]?.ids ?? EMPTY_IDS)], done),
    bulkMove: (target) => void bulkMove(listId, target),
    bulkCopy: () => void copyToClipboard([...(selByPane[listId]?.ids ?? EMPTY_IDS)]),
    bulkDelete: () => void bulkDelete(listId),
  });

  // ----- shared row context -----
  const ctx: BaseRowCtx = {
    childrenByParent,
    collapsed: layout.collapsed,
    toggleCollapsed: layout.toggleCollapsed,
    selectedTaskId,
    select: (id) => useSelectionStore.getState().focus(id),
    requestRename: beginTitleEdit,
    dropTarget,
    setDropTarget,
    draggingId,
    setDraggingId,
    composeFor,
    setComposeFor,
    otherLists: listsInProject,
    onToggleDone: toggleDone,
    onRequestDelete: requestDeleteTask,
    onMoveToList: (id, listId) => void actMove(id, null, listId),
    onPromote: (task) => void actMove(task.id, null, task.list_id),
    onCreateSubtask: createSubtask,
    onDropOnRow: (draggedId, target, zone) => void actDropOnRow(draggedId, target, zone),
    onDropSetOnRow: (ids, target, zone) => void actDropSetOnRow(ids, target, zone),
    onCopy: copyToClipboard,
  };

  const registerSearchFocus = useCallback(
    (listId: string, focus: ((seed?: string) => void) | null) => {
      if (focus) searchFocusers.current.set(listId, focus);
      else searchFocusers.current.delete(listId);
    },
    []
  );

  // The macOS "List" menu forwards clicks here as events.
  useEffect(() => {
    const un1 = listen('menu:import-list', () => void importList());
    const un2 = listen('menu:export-list', () => {
      if (activeList) void exportList(activeList);
    });
    return () => {
      un1.then((fn) => fn());
      un2.then((fn) => fn());
    };
  }, [importList, exportList, activeList]);

  // The standalone filter overlay window streams a pane's edited view back here.
  useEffect(() => {
    const un = listen<{ paneId: string; view: PaneView }>('overlay-apply', (e) =>
      useViewStore.getState().set(e.payload.paneId, e.payload.view)
    );
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  // ----- navigation helpers -----
  const cycleTab = (dir: -1 | 1) => {
    const n = listsInProject.length;
    if (n === 0) return;
    const idx = listsInProject.findIndex((l) => l.id === focusedListId);
    const next = listsInProject[((idx < 0 ? 0 : idx) + dir + n) % n];
    if (next) useLayoutStore.getState().selectList(next.id);
  };
  const cycleProject = (dir: -1 | 1) => {
    const n = projects.length;
    if (n === 0) return;
    const idx = projects.findIndex((p) => p.id === activeProjectId);
    const next = projects[((idx < 0 ? 0 : idx) + dir + n) % n];
    if (next && next.id !== activeProjectId) selectProject(next.id);
  };
  const reorderSelected = (dir: -1 | 1) => {
    const t = selectedTask;
    if (!t) return;
    const sibs = (t.parent_id ? childrenByParent[t.parent_id] : rootsByList[t.list_id]) ?? [];
    const idx = sibs.findIndex((s) => s.id === t.id);
    const target = dir < 0 ? sibs[idx - 1] : sibs[idx + 1];
    if (target) void actDropOnRow(t.id, target, dir < 0 ? 'before' : 'after');
  };
  const splitTargetId = () =>
    layout.splitListId ?? listsInProject.find((l) => l.id !== layout.activeListId)?.id ?? null;
  const focusOtherPane = () => {
    const { activeListId, splitListId } = useLayoutStore.getState();
    if (!splitListId) return;
    useLayoutStore
      .getState()
      .setPaneFocus(focusedListId === splitListId ? (activeListId ?? splitListId) : splitListId);
  };
  const collapseAll = () =>
    useLayoutStore.getState().setCollapsed(new Set(Object.keys(childrenByParent)));
  const expandAll = () => useLayoutStore.getState().setCollapsed(new Set());

  // The ⌘K palette's command list — catalog actions, quick actions, and jump-to
  // navigation. Rebuilt when opened (cheap).
  const buildCommands = (): import('./components/CommandPalette').PaletteCommand[] => {
    const accel = (id: string) => hotkeyMap[id];
    const cmds: import('./components/CommandPalette').PaletteCommand[] = [
      { id: 'toggle_preview', group: 'View', label: 'Toggle preview', icon: 'right_panel_open', accel: accel('toggle_preview'), run: () => useLayoutStore.getState().togglePreview() },
      { id: 'toggle_split', group: 'View', label: 'Toggle split view', icon: 'vertical_split', accel: accel('toggle_split'), run: () => { const t = splitTargetId(); if (t) useLayoutStore.getState().toggleSplit(t); } },
      { id: 'swap_panes', group: 'View', label: 'Swap panes', icon: 'swap_horiz', run: () => useLayoutStore.getState().swapPanes() },
      { id: 'toggle_completed', group: 'View', label: 'Show / hide completed', icon: 'visibility', accel: accel('toggle_completed'), run: () => useSettingsStore.getState().toggleShowCompleted() },
      { id: 'collapse_all', group: 'View', label: 'Collapse all', icon: 'unfold_less', accel: accel('collapse_all'), run: collapseAll },
      { id: 'expand_all', group: 'View', label: 'Expand all', icon: 'unfold_more', accel: accel('expand_all'), run: expandAll },
      { id: 'new_task', group: 'Task', label: 'New task', icon: 'add', accel: accel('new_task'), run: () => { if (focusedListId) void startNewTask(focusedListId); } },
      { id: 'search', group: 'Task', label: 'Search this list', icon: 'search', accel: accel('search'), run: () => { if (focusedListId) searchFocusers.current.get(focusedListId)?.(); } },
      { id: 'undo', group: 'Task', label: 'Undo', icon: 'undo', accel: accel('undo'), run: () => void useHistoryStore.getState().undo() },
      { id: 'redo', group: 'Task', label: 'Redo', icon: 'redo', accel: accel('redo'), run: () => void useHistoryStore.getState().redo() },
      { id: 'new_list', group: 'Manage', label: 'New list', icon: 'playlist_add', accel: accel('new_list'), run: createList },
      { id: 'new_project', group: 'Manage', label: 'New project', icon: 'create_new_folder', accel: accel('new_project'), run: createProject },
      { id: 'trash', group: 'Manage', label: 'Open Trash', icon: 'delete', run: () => setTrashOpen(true) },
      { id: 'open_settings', group: 'Manage', label: 'Settings', icon: 'settings', accel: accel('open_settings'), run: () => api.openSettings() },
      { id: 'shortcuts', group: 'Manage', label: 'Keyboard shortcuts', icon: 'keyboard', run: () => setCheatOpen(true) },
    ];
    if (selectedTask)
      cmds.push({ id: 'delete_sel', group: 'Task', label: `Delete “${selectedTask.title}”`, icon: 'delete', run: () => requestDeleteTask(selectedTask) });
    for (const l of listsInProject)
      cmds.push({ id: `go-list-${l.id}`, group: 'Go to list', label: l.name, icon: 'list', run: () => useLayoutStore.getState().selectList(l.id) });
    for (const p of projects)
      cmds.push({ id: `go-proj-${p.id}`, group: 'Go to project', label: p.name, icon: 'folder', run: () => selectProject(p.id) });
    return cmds;
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      const pressed = (id: string) => matchesEvent(hotkeyMap[id] ?? '', e);
      const setPane = useSelectionStore.getState().setPane;
      const focus = useSelectionStore.getState().focus;
      const paneSel = useSelectionStore.getState().paneSel;
      const scrollTo = (id: string) =>
        document
          .querySelector(`[data-task-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest' });

      if (pressed('search')) {
        e.preventDefault();
        if (focusedListId) searchFocusers.current.get(focusedListId)?.();
        return;
      }
      if (pressed('new_task')) {
        e.preventDefault();
        if (focusedListId) void startNewTask(focusedListId);
        return;
      }
      if (pressed('open_settings')) {
        e.preventDefault();
        api.openSettings();
        return;
      }
      if (pressed('toggle_preview')) {
        e.preventDefault();
        useLayoutStore.getState().togglePreview();
        return;
      }
      if (pressed('prev_tab') || pressed('next_tab')) {
        e.preventDefault();
        cycleTab(pressed('prev_tab') ? -1 : 1);
        return;
      }
      if (pressed('prev_project') || pressed('next_project')) {
        e.preventDefault();
        cycleProject(pressed('prev_project') ? -1 : 1);
        return;
      }
      if (pressed('command_palette')) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (pressed('toggle_split')) {
        e.preventDefault();
        const t = splitTargetId();
        if (t) useLayoutStore.getState().toggleSplit(t);
        return;
      }
      if (pressed('focus_other_pane')) {
        e.preventDefault();
        focusOtherPane();
        return;
      }
      if (pressed('new_list')) {
        e.preventDefault();
        void createList();
        return;
      }
      if (pressed('new_project')) {
        e.preventDefault();
        void createProject();
        return;
      }
      if (pressed('toggle_completed')) {
        e.preventDefault();
        useSettingsStore.getState().toggleShowCompleted();
        return;
      }

      if (!typing) {
        if (pressed('undo') || pressed('redo')) {
          e.preventDefault();
          if (pressed('redo')) void useHistoryStore.getState().redo();
          else void useHistoryStore.getState().undo();
          return;
        }
        if (pressed('collapse_all')) {
          e.preventDefault();
          collapseAll();
          return;
        }
        if (pressed('expand_all')) {
          e.preventDefault();
          expandAll();
          return;
        }
        for (let i = 1; i <= 9; i++) {
          if (pressed(`switch_list_${i}`)) {
            const list = listsInProject[i - 1];
            if (list) {
              e.preventDefault();
              useLayoutStore.getState().selectList(list.id);
            }
            return;
          }
        }
        if (pressed('select_all')) {
          if (focusedListId) {
            e.preventDefault();
            useLayoutStore.getState().setPaneFocus(focusedListId);
            useSelectionStore
              .getState()
              .selectAll(focusedListId, flattenVisible(focusedListId).map((t) => t.id));
          }
          return;
        }
        if (pressed('move_up') || pressed('move_down')) {
          e.preventDefault();
          reorderSelected(pressed('move_up') ? -1 : 1);
          return;
        }
        if (pressed('delete_task')) {
          if (focusedListId && paneSel(focusedListId).ids.size > 0) {
            e.preventDefault();
            void bulkDelete(focusedListId);
            return;
          }
          if (selectedTask) {
            e.preventDefault();
            requestDeleteTask(selectedTask);
          }
          return;
        }
      }

      if (typing) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const listId = focusedListId;
        if (!listId) return;
        const flat = flattenVisible(listId);
        if (flat.length === 0) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const idx = flat.findIndex((t) => t.id === selectedTaskId);
        if (e.shiftKey) {
          const nidx =
            idx < 0 ? (dir > 0 ? 0 : flat.length - 1) : Math.min(Math.max(idx + dir, 0), flat.length - 1);
          const active = flat[nidx].id;
          const cur = paneSel(listId);
          const anchor = cur.anchor ?? selectedTaskId ?? active;
          const order = flat.map((t) => t.id);
          const a = order.indexOf(anchor);
          const b = order.indexOf(active);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          setPane(listId, new Set(order.slice(lo, hi + 1)), anchor);
          focus(active);
          scrollTo(active);
        } else {
          const nidx = idx < 0 ? (dir > 0 ? 0 : flat.length - 1) : (idx + dir + flat.length) % flat.length;
          const active = flat[nidx].id;
          setPane(listId, new Set(), active);
          focus(active);
          scrollTo(active);
        }
      } else if (e.key === 'ArrowLeft' && selectedTask) {
        const t = selectedTask;
        const kids = (childrenByParent[t.id] ?? []).length;
        if (kids > 0 && !layout.collapsed.has(t.id)) {
          e.preventDefault();
          layout.toggleCollapsed(t.id);
        } else if (t.parent_id && focusedListId) {
          e.preventDefault();
          setPane(focusedListId, new Set(), t.parent_id);
          focus(t.parent_id);
          scrollTo(t.parent_id);
        }
      } else if (e.key === 'ArrowRight' && selectedTask) {
        const t = selectedTask;
        const kids = childrenByParent[t.id] ?? [];
        if (kids.length === 0) return;
        e.preventDefault();
        if (layout.collapsed.has(t.id)) {
          layout.toggleCollapsed(t.id);
        } else if (focusedListId) {
          const first = kids[0].id;
          setPane(focusedListId, new Set(), first);
          focus(first);
          scrollTo(first);
        }
      } else if (e.key === 'Tab' && selectedTask) {
        e.preventDefault();
        const t = selectedTask;
        if (e.shiftKey) {
          // Outdent: become a sibling of the parent, just after it.
          const parent = t.parent_id ? taskById[t.parent_id] : null;
          if (parent) void actDropOnRow(t.id, parent, 'after');
        } else {
          // Indent: nest under the previous visible sibling.
          const sibs = (t.parent_id ? childrenByParent[t.parent_id] : rootsByList[t.list_id]) ?? [];
          const prev = sibs[sibs.findIndex((s) => s.id === t.id) - 1];
          if (prev) void actDropOnRow(t.id, prev, 'nest');
        }
      } else if (e.key === ' ') {
        // Space toggles the whole selection when one is live (flip to all-done,
        // or all-undone when they already are), else the single previewed task.
        const selIds = focusedListId ? [...paneSel(focusedListId).ids] : [];
        if (selIds.length > 0) {
          e.preventDefault();
          const allDone = selIds.every((id) => taskById[id]?.done);
          void actSetTasksDone(selIds, !allDone);
        } else if (selectedTask) {
          e.preventDefault();
          toggleDone(selectedTask);
        }
      } else if ((e.key === 'F2' || e.key === 'Enter') && selectedTask) {
        e.preventDefault();
        beginTitleEdit(selectedTask.id);
      } else if (e.key === 'Escape') {
        if (overlayOpen()) return;
        if (trashOpen) {
          setTrashOpen(false);
          return;
        }
        const listId = focusedListId;
        if (listId && paneSel(listId).ids.size > 0) useSelectionStore.getState().clear(listId);
        else focus(null);
      } else if (e.key === '?' && !overlayOpen()) {
        e.preventDefault();
        setCheatOpen(true);
      } else if (
        e.key.length === 1 &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !overlayOpen()
      ) {
        const focusSearch = focusedListId ? searchFocusers.current.get(focusedListId) : undefined;
        if (focusSearch) {
          e.preventDefault();
          focusSearch(e.key);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ----- preview: focused pane's selection drives the multi/single inspector --
  const focusSelIds = focusedListId ? (selByPane[focusedListId]?.ids ?? EMPTY_IDS) : EMPTY_IDS;
  const selectionTasks = focusedListId
    ? (() => {
        const inOrder = flattenVisible(focusedListId).filter((t) => focusSelIds.has(t.id));
        const seen = new Set(inOrder.map((t) => t.id));
        for (const id of focusSelIds)
          if (!seen.has(id) && taskById[id]) inOrder.push(taskById[id]);
        return inOrder;
      })()
    : [];
  const listNameById = (listId: string) => lists.find((l) => l.id === listId)?.name ?? null;
  const projectNameOfList = (listId: string) =>
    projects.find((p) => p.id === lists.find((l) => l.id === listId)?.project_id)
      ?.name ?? null;

  // ----- layout -----
  return (
    <ContextMenuProvider>
      <div className="bg-surface-1l dark:bg-surface-1d text-content-1l dark:text-content-1d flex h-screen w-screen flex-col overflow-hidden">
        <TitleBar
          projects={projects}
          selectedProjectId={activeProjectId}
          onSelectProject={selectProject}
          onCreateProject={createProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          lists={listsInProject}
          activeListId={layout.activeListId}
          splitListId={layout.splitListId}
          focusedListId={focusedListId}
          counts={counts}
          onSelectList={(id) => useLayoutStore.getState().selectList(id)}
          onCreateList={createList}
          onRenameList={renameList}
          onRenameListInline={(id, name) => void useListStore.getState().rename(id, name)}
          onDeleteList={deleteList}
          onExportList={exportList}
          onToggleSplit={(id) => useLayoutStore.getState().toggleSplit(id)}
          onSwapPanes={() => useLayoutStore.getState().swapPanes()}
          onDropTaskOnTab={(taskId, listId) => void actMove(taskId, null, listId)}
          onDropTaskSetOnTab={(ids, listId) => void actDropSetOnRoot(ids, listId)}
          onReorderList={reorderList}
          previewOpen={layout.previewOpen}
          onTogglePreview={() => useLayoutStore.getState().togglePreview()}
          hotkeys={hotkeyMap}
        />

        <div className="flex min-h-0 flex-1">
          {activeList ? (
            <div className="flex min-w-0 flex-1">
              <div
                className="flex min-w-0"
                style={{ flexBasis: splitList ? `${layout.splitRatio * 100}%` : '100%' }}
              >
                <TaskPane
                  list={activeList}
                  ctx={ctx}
                  sel={makeSel(activeList.id)}
                  isSplit={false}
                  onNewTask={startNewTask}
                  registerSearchFocus={registerSearchFocus}
                  onFocusPane={(id) => useLayoutStore.getState().setPaneFocus(id)}
                  captureHint={formatAccel(hotkeyMap['toggle_capture_bar'] ?? '')}
                />
              </div>
              {splitList && (
                <>
                  <Resizer
                    onResize={(x, rect) =>
                      useLayoutStore
                        .getState()
                        .setSplitRatio(Math.min(0.75, Math.max(0.25, (x - rect.left) / rect.width)))
                    }
                    onReset={() => useLayoutStore.getState().resetSplitRatio()}
                  />
                  <div className="border-edge-2l dark:border-edge-2d flex min-w-0 flex-1 border-l">
                    <TaskPane
                      list={splitList}
                      ctx={ctx}
                      sel={makeSel(splitList.id)}
                      isSplit
                      onCloseSplit={() => useLayoutStore.getState().closeSplit()}
                      onNewTask={startNewTask}
                      registerSearchFocus={registerSearchFocus}
                      onFocusPane={(id) => useLayoutStore.getState().setPaneFocus(id)}
                      captureHint={formatAccel(hotkeyMap['toggle_capture_bar'] ?? '')}
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="bg-surface-2l dark:bg-surface-2d flex flex-1 flex-col items-center justify-center gap-3">
              <p className="font-display text-content-2l dark:text-content-2d text-[17px] font-medium">
                No lists yet
              </p>
              <button
                onClick={createList}
                className="rounded-control bg-accent-500l dark:bg-accent-500d text-on-accent hover:bg-accent-600l dark:hover:bg-accent-600d active:bg-accent-700l dark:active:bg-accent-700d px-4 py-2 text-[13px] font-semibold tracking-[0.01em] transition-colors"
              >
                Create your first list
              </button>
            </div>
          )}

          {(layout.previewOpen || trashOpen) && (
            <>
              <Resizer
                onResize={(x, rect) =>
                  useLayoutStore
                    .getState()
                    .setPreviewW(Math.min(420, Math.max(280, rect.right - x)))
                }
              />
              <aside
                style={{ width: layout.previewW }}
                className="border-edge-2l dark:border-edge-2d shrink-0 border-l"
              >
                {trashOpen ? (
                  <TrashPane onClose={() => setTrashOpen(false)} />
                ) : (
                <PreviewPanel
                  task={selectedTask}
                  childrenByParent={childrenByParent}
                  listName={selectedTask ? listNameById(selectedTask.list_id) : null}
                  projectName={
                    selectedTask
                      ? (projects.find(
                          (p) => p.id === lists.find((l) => l.id === selectedTask.list_id)?.project_id
                        )?.name ?? null)
                      : null
                  }
                  onUpdateTask={updateTask}
                  onToggleDone={toggleDone}
                  onSelectTask={(id) => useSelectionStore.getState().focus(id)}
                  onRequestDelete={requestDeleteTask}
                  onRefresh={() => useTaskStore.getState().load()}
                  onClose={() => useLayoutStore.getState().setPreviewOpen(false)}
                  titleEditReq={titleEditReq}
                  onTitleEditStarted={clearTitleEditReq}
                  addNoteReq={addNoteReq}
                  onAddNoteStarted={clearAddNoteReq}
                  draftListId={draftListId}
                  draftProjectName={draftListId ? projectNameOfList(draftListId) : null}
                  draftListName={draftListId ? listNameById(draftListId) : null}
                  onDraftAction={runDraftAction}
                  selectionTasks={selectionTasks}
                  listNameById={listNameById}
                  moveTargets={listsInProject}
                  onBulkSetDone={
                    focusedListId
                      ? (done) => void actSetTasksDone([...focusSelIds], done)
                      : undefined
                  }
                  onBulkMove={focusedListId ? (target) => void bulkMove(focusedListId, target) : undefined}
                  onBulkDelete={focusedListId ? () => void bulkDelete(focusedListId) : undefined}
                  onBulkCopy={focusedListId ? () => void copyToClipboard([...focusSelIds]) : undefined}
                  onClearSelection={
                    focusedListId ? () => useSelectionStore.getState().clear(focusedListId) : undefined
                  }
                  onOpenOne={(id) => {
                    if (focusedListId) useSelectionStore.getState().setPane(focusedListId, new Set(), id);
                    useSelectionStore.getState().focus(id);
                  }}
                />
                )}
              </aside>
            </>
          )}
        </div>

        {!ready && (
          <div className="z-overlay bg-surface-1l dark:bg-surface-1d absolute inset-0 grid place-items-center">
            <Spinner size={26} label="Loading…" />
          </div>
        )}
      </div>

      {paletteOpen && (
        <CommandPalette getCommands={buildCommands} onClose={() => setPaletteOpen(false)} />
      )}
      {cheatOpen && <CheatSheet onClose={() => setCheatOpen(false)} />}
      <Toast />
    </ContextMenuProvider>
  );
}

/** Invisible grab strip over a hairline that brightens while resizing. */
function Resizer({
  onResize,
  onReset,
}: {
  onResize: (clientX: number, rect: DOMRect) => void;
  onReset?: () => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      onDoubleClick={onReset}
      onMouseDown={(e) => {
        e.preventDefault();
        setActive(true);
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: MouseEvent) => onResize(ev.clientX, rect);
        const up = () => {
          setActive(false);
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
      className="z-raised relative -mr-1.25 w-1.25 shrink-0 cursor-col-resize"
    >
      <span
        className={`absolute inset-y-0 left-0 w-px transition-colors ${
          active
            ? 'bg-edge-3l dark:bg-edge-3d'
            : 'hover:bg-edge-2l dark:hover:bg-edge-2d bg-transparent'
        }`}
      />
    </div>
  );
}

export default App;
