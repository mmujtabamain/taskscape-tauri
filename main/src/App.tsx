import { formatAccel, matchesEvent } from '@taskscape/common-ui/hotkeys';
import { Spinner } from '@taskscape/common-ui/Spinner';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type List, type Project, type Task, type TaskPatch } from './api';
import { ContextMenuProvider } from './components/ContextMenu';
import { PreviewPanel } from './components/PreviewPanel';
import { TaskPane, type PaneSelection } from './components/TaskPane';
import type { BaseRowCtx, ClickMods, DropZone } from './components/TaskRow';
import { TitleBar } from './components/TitleBar';
import { confirmModal, promptName, promptNewList } from './lib/modal';
import { overlayOpen } from './lib/overlays';
import {
  collapseToRoots,
  EMPTY_SELECTION,
  rangeBetween,
} from './lib/selection';

const effSort = (t: Task) => t.sort_order || t.created_at;

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allLists, setAllLists] = useState<List[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [ready, setReady] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [splitListId, setSplitListId] = useState<string | null>(
    () => localStorage.getItem('ui.split') || null
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Which pane the user last worked in. Drives the active-tab highlight and
  // keyboard targeting when split view is open.
  const [paneFocus, setPaneFocus] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(
    () => localStorage.getItem('ui.preview') !== '0'
  );
  const [previewW, setPreviewW] = useState(
    () => Number(localStorage.getItem('ui.previewW')) || 320
  );
  const [splitRatio, setSplitRatio] = useState(
    () => Number(localStorage.getItem('ui.splitRatio')) || 0.5
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Ambient multi-selection, per pane (keyed by the list the pane shows, so the
  // two panes select independently). `anchor` is where a ⇧-range extends from.
  const [selByPane, setSelByPane] = useState<
    Record<string, { ids: Set<string>; anchor: string | null }>
  >({});
  const [composeFor, setComposeFor] = useState<string | null>(null);
  // A task is renamed in the preview inspector, never inline. This flags the
  // inspector to start editing its title; the nonce lets a repeat request on the
  // already-open task re-trigger the edit.
  const [titleEditReq, setTitleEditReq] = useState<{
    id: string;
    n: number;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    zone: DropZone;
  } | null>(null);

  // The search input lives in TitleBar; it registers a focus handler here so ⌘F
  // can focus it without threading a ref through props (mirrors registerComposer).
  const searchFocusRef = useRef<(() => void) | null>(null);
  const registerSearch = useCallback((focus: (() => void) | null) => {
    searchFocusRef.current = focus;
  }, []);
  const composers = useRef(new Map<string, (seed?: string) => void>());

  // Refs mirror the current selection so `load` (a stable callback) can preserve
  // it across refreshes without going stale.
  const projectIdRef = useRef<string | null>(null);
  const listIdRef = useRef<string | null>(null);
  useEffect(() => {
    projectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);
  useEffect(() => {
    listIdRef.current = activeListId;
  }, [activeListId]);

  const load = useCallback(async () => {
    const [fetchedProjects, lists, tasks, activeProject, activeList, showDone] =
      await Promise.all([
        api.listProjects(),
        api.listLists(),
        api.allTasks(),
        api.getSetting('last_active_project'),
        api.getSetting('last_active_list'),
        api.getSetting('show_completed'),
      ]);

    // A brand-new database has no projects yet — seed one so lists have a home.
    let nextProjects = fetchedProjects;
    if (nextProjects.length === 0) {
      nextProjects = [await api.defaultProject()];
    }

    setProjects(nextProjects);
    setAllLists(lists);
    setAllTasks(tasks);
    setShowCompleted(showDone !== '0');

    const curP = projectIdRef.current;
    const projectId =
      curP && nextProjects.some((p) => p.id === curP)
        ? curP
        : activeProject && nextProjects.some((p) => p.id === activeProject)
          ? activeProject
          : (nextProjects[0]?.id ?? null);
    setSelectedProjectId(projectId);

    const inProject = lists.filter((l) => l.project_id === projectId);
    const curL = listIdRef.current;
    const listId =
      curL && inProject.some((l) => l.id === curL)
        ? curL
        : activeList && inProject.some((l) => l.id === activeList)
          ? activeList
          : (inProject[0]?.id ?? null);
    setActiveListId(listId);

    setSplitListId((s) =>
      s && s !== listId && inProject.some((l) => l.id === s) ? s : null
    );
    setSelectedTaskId((t) => (t && tasks.some((x) => x.id === t) ? t : null));

    // Drop any selected ids that no longer exist (deleted here or by the tray),
    // so bulk actions never target a missing task.
    const alive = new Set(tasks.map((t) => t.id));
    setSelByPane((prev) => {
      const next: typeof prev = {};
      let changed = false;
      for (const [key, v] of Object.entries(prev)) {
        const ids = new Set([...v.ids].filter((id) => alive.has(id)));
        const anchor = v.anchor && alive.has(v.anchor) ? v.anchor : null;
        if (ids.size !== v.ids.size || anchor !== v.anchor) changed = true;
        if (ids.size > 0 || anchor) next[key] = { ids, anchor };
        else changed = true;
      }
      return changed ? next : prev;
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Reload when the tray process captures a task into the shared database.
  useEffect(() => {
    const un1 = listen('refresh', () => load());
    const un2 = listen('settings-changed', () => load());
    return () => {
      un1.then((fn) => fn());
      un2.then((fn) => fn());
    };
  }, [load]);

  // Effective hotkey combos by command id. Rust owns the catalog; the map is
  // rebuilt when the settings window closes (`hotkeys-changed`).
  const [hotkeyMap, setHotkeyMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const loadHotkeys = () =>
      api
        .listHotkeys()
        .then((bindings) =>
          setHotkeyMap(Object.fromEntries(bindings.map((b) => [b.id, b.accel])))
        )
        .catch(() => {});
    void loadHotkeys();
    const un = listen('hotkeys-changed', loadHotkeys);
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  // Remember the active project/list so we can restore them next launch, and so
  // tray captures land in the last-used list.
  useEffect(() => {
    if (selectedProjectId)
      api.setActiveProject(selectedProjectId).catch(() => {});
  }, [selectedProjectId]);

  useEffect(() => {
    if (splitListId) localStorage.setItem('ui.split', splitListId);
    else localStorage.removeItem('ui.split');
  }, [splitListId]);
  useEffect(() => {
    localStorage.setItem('ui.preview', previewOpen ? '1' : '0');
  }, [previewOpen]);
  useEffect(() => {
    localStorage.setItem('ui.previewW', String(previewW));
  }, [previewW]);
  useEffect(() => {
    localStorage.setItem('ui.splitRatio', String(splitRatio));
  }, [splitRatio]);

  // ----- derived data -----
  const taskById = useMemo(() => {
    const m: Record<string, Task> = {};
    for (const t of allTasks) m[t.id] = t;
    return m;
  }, [allTasks]);

  const childrenByParent = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of allTasks) {
      if (t.parent_id) (m[t.parent_id] ??= []).push(t);
    }
    for (const k in m) m[k].sort((a, b) => effSort(a) - effSort(b));
    return m;
  }, [allTasks]);

  const rootsByList = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of allTasks) {
      if (t.parent_id == null) (m[t.list_id] ??= []).push(t);
    }
    for (const k in m) m[k].sort((a, b) => effSort(a) - effSort(b));
    return m;
  }, [allTasks]);

  const listsInProject = useMemo(
    () => allLists.filter((l) => l.project_id === selectedProjectId),
    [allLists, selectedProjectId]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of allTasks) {
      if (t.parent_id == null && !t.done)
        c[t.list_id] = (c[t.list_id] ?? 0) + 1;
    }
    return c;
  }, [allTasks]);

  // Parents with an undone descendant stay visible even when "hide completed" is on.
  const hasPendingDesc = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTasks) {
      if (t.done) continue;
      let p = t.parent_id;
      while (p && !s.has(p)) {
        s.add(p);
        p = taskById[p]?.parent_id ?? null;
      }
    }
    return s;
  }, [allTasks, taskById]);

  // Search shows matches plus their ancestors, so the tree keeps its shape.
  const query = search.trim().toLowerCase();
  const searchSet = useMemo(() => {
    if (!query) return null;
    const s = new Set<string>();
    for (const t of allTasks) {
      if (
        t.title.toLowerCase().includes(query) ||
        t.notes?.toLowerCase().includes(query)
      ) {
        s.add(t.id);
        let p = t.parent_id;
        while (p && !s.has(p)) {
          s.add(p);
          p = taskById[p]?.parent_id ?? null;
        }
      }
    }
    return s;
  }, [query, allTasks, taskById]);

  const isVisible = useCallback(
    (t: Task) => {
      if (searchSet && !searchSet.has(t.id)) return false;
      if (!showCompleted && t.done && !hasPendingDesc.has(t.id)) return false;
      return true;
    },
    [searchSet, showCompleted, hasPendingDesc]
  );

  const activeList = listsInProject.find((l) => l.id === activeListId) ?? null;
  const splitList = listsInProject.find((l) => l.id === splitListId) ?? null;
  const selectedTask = selectedTaskId
    ? (taskById[selectedTaskId] ?? null)
    : null;

  // The focused pane's list — one of the two visible panes, falling back to the
  // left (active) pane whenever `paneFocus` points at a list that isn't on
  // screen (e.g. after a project switch or closing the split).
  const focusedListId =
    paneFocus != null &&
    (paneFocus === activeListId || paneFocus === splitListId)
      ? paneFocus
      : activeListId;

  useEffect(() => {
    if (focusedListId) api.setActiveList(focusedListId).catch(() => {});
  }, [focusedListId]);

  // ----- mutations -----
  const createProject = async () => {
    const name = await promptName({
      title: 'New project',
      icon: 'create_new_folder',
      suggestKind: 'project',
    });
    if (!name) return;
    const project = await api.createProject(name);
    projectIdRef.current = project.id;
    listIdRef.current = null;
    await load();
  };

  const renameProject = async (project: Project) => {
    const name = await promptName({
      title: 'Rename project',
      icon: 'edit',
      initialValue: project.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === project.name) return;
    await api.renameProject(project.id, name);
    await load();
  };

  const deleteProject = async (project: Project) => {
    const listIds = allLists
      .filter((l) => l.project_id === project.id)
      .map((l) => l.id);
    const taskCount = allTasks.filter((t) =>
      listIds.includes(t.list_id)
    ).length;
    const ok = await confirmModal({
      danger: true,
      title: `Delete “${project.name}”?`,
      message: `Its ${listIds.length} list${listIds.length === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'} are deleted with it. This cannot be undone.`,
      confirmLabel: 'Delete project',
    });
    if (!ok) return;
    await api.deleteProject(project.id);
    if (project.id === projectIdRef.current) {
      projectIdRef.current = null;
      listIdRef.current = null;
    }
    await load();
  };

  // Import a JSON list file into a new list in the current project (`name`
  // overrides the document's embedded list name when given).
  const importList = useCallback(
    async (name?: string) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;
      const path = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (typeof path !== 'string') return;
      const list = await api.importList(projectId, path, name);
      listIdRef.current = list.id;
      await load();
    },
    [load]
  );

  // Select mode's copy: the backend renders the tasks as a Markdown checklist;
  // we just place it on the clipboard.
  const copyTasksToClipboard = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const md = await api.copyTasks(ids);
    if (md) await navigator.clipboard.writeText(md);
  }, []);

  // Export a whole list (tasks, subtasks, notes, reference attachments) to JSON.
  const exportList = useCallback(async (list: List) => {
    const path = await save({
      defaultPath: `${list.name}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    await api.exportList(list.id, path);
  }, []);

  const createList = async () => {
    if (!selectedProjectId) return;
    const res = await promptNewList();
    if (!res) return;
    if (res.action === 'import') {
      await importList();
      return;
    }
    const list = await api.createList(selectedProjectId, res.name);
    listIdRef.current = list.id;
    await load();
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
    await api.renameList(list.id, name);
    await load();
  };

  // Tab reorder: rewrite every tab's sort_order to evenly spaced integers in the
  // new visual order. Lists are few, so a full rebuild is cheap and collision-free.
  const reorderList = async (
    draggedId: string,
    targetId: string,
    before: boolean
  ) => {
    const dragged = listsInProject.find((l) => l.id === draggedId);
    const rest = listsInProject.filter((l) => l.id !== draggedId);
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
    await load();
  };

  const deleteList = async (list: List) => {
    const taskCount = allTasks.filter((t) => t.list_id === list.id).length;
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
    await api.deleteList(list.id);
    if (list.id === listIdRef.current) listIdRef.current = null;
    await load();
  };

  const createTask = async (listId: string, title: string) => {
    setPaneFocus(listId);
    const task = await api.createTask(listId, title);
    setSelectedTaskId(task.id);
    await load();
  };

  const createSubtask = async (parentId: string, title: string) => {
    const parent = taskById[parentId];
    if (!parent) return;
    await api.createTask(parent.list_id, title, undefined, parentId);
    setCollapsed((s) => {
      if (!s.has(parentId)) return s;
      const next = new Set(s);
      next.delete(parentId);
      return next;
    });
    await load();
  };

  const updateTask = async (id: string, patch: TaskPatch) => {
    await api.updateTask(id, patch);
    await load();
  };

  const toggleDone = (task: Task) => updateTask(task.id, { done: !task.done });

  const subtreeSize = useCallback(
    (id: string): number => {
      const count = (i: string): number => {
        const kids = childrenByParent[i] ?? [];
        return kids.reduce((n, k) => n + 1 + count(k.id), 0);
      };
      return count(id);
    },
    [childrenByParent]
  );

  const requestDeleteTask = async (task: Task) => {
    const subs = subtreeSize(task.id);
    const ok = await confirmModal({
      danger: true,
      title: 'Delete task?',
      message:
        `“${task.title}”` +
        (subs > 0 ? ` and its ${subs} subtask${subs === 1 ? '' : 's'}` : '') +
        ' will be permanently deleted.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await api.deleteTask(task.id);
    if (selectedTaskId === task.id) setSelectedTaskId(null);
    await load();
  };

  const moveTask = async (
    id: string,
    parentId: string | null,
    listId: string | null,
    sortOrder?: number
  ) => {
    await api.moveTask(id, parentId, listId, sortOrder);
    await load();
  };

  const isInSubtree = useCallback(
    (candidateId: string, rootId: string): boolean => {
      let cur: string | null = candidateId;
      while (cur) {
        if (cur === rootId) return true;
        cur = taskById[cur]?.parent_id ?? null;
      }
      return false;
    },
    [taskById]
  );

  const dropOnRow = async (draggedId: string, target: Task, zone: DropZone) => {
    if (isInSubtree(target.id, draggedId)) return;
    if (zone === 'nest') {
      moveTask(draggedId, target.id, null);
      return;
    }
    const parentId = target.parent_id;
    const listArg = parentId ? null : target.list_id;
    const siblings = (
      parentId
        ? (childrenByParent[parentId] ?? [])
        : (rootsByList[target.list_id] ?? [])
    ).filter((t) => t.id !== draggedId);
    const targetIdx = siblings.findIndex((t) => t.id === target.id);
    const insertIdx = zone === 'before' ? targetIdx : targetIdx + 1;
    const prev = siblings[insertIdx - 1];
    const next = siblings[insertIdx];

    // No gap between neighbors (equal timestamps, or midpoints exhausted after
    // many reorders): rebuild the whole group at evenly spaced integers with the
    // dragged task in its new slot, instead of trusting a colliding midpoint.
    if (prev && next && effSort(next) - effSort(prev) < 1) {
      const ordered = [
        ...siblings.slice(0, insertIdx),
        null,
        ...siblings.slice(insertIdx),
      ];
      await Promise.all(
        ordered.map((t, i) =>
          t
            ? api.reorderTask(t.id, (i + 1) * 1000)
            : api.moveTask(draggedId, parentId, listArg, (i + 1) * 1000)
        )
      );
      load();
      return;
    }

    let sort: number;
    if (!prev) sort = next ? effSort(next) - 1000 : effSort(target) - 1000;
    else if (!next) sort = effSort(prev) + 1000;
    else sort = (effSort(prev) + effSort(next)) / 2;
    moveTask(draggedId, parentId, listArg, sort);
  };

  const dropOnRoot = (draggedId: string, listId: string) => {
    const roots = (rootsByList[listId] ?? []).filter((t) => t.id !== draggedId);
    const last = roots[roots.length - 1];
    moveTask(draggedId, null, listId, last ? effSort(last) + 1000 : undefined);
  };

  const selectList = (id: string) => {
    // Each pane is independent and panes never swap sides. Clicking a tab
    // already shown in a pane just focuses that pane; clicking any other tab
    // loads it into whichever pane the user is currently working in, leaving the
    // other pane untouched.
    if (id === activeListId || id === splitListId) {
      setPaneFocus(id);
      return;
    }
    if (splitListId != null && focusedListId === splitListId) {
      setSplitListId(id);
    } else {
      listIdRef.current = id;
      setActiveListId(id);
    }
    setPaneFocus(id);
  };

  const toggleSplit = (id: string) => {
    setSplitListId((s) => (s === id ? null : id === activeListId ? s : id));
  };

  // Open the task in the preview and ask its inspector to edit the title.
  const beginTitleEdit = (id: string) => {
    setSelectedTaskId(id);
    setPreviewOpen(true);
    setTitleEditReq((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  };
  const clearTitleEditReq = useCallback(() => setTitleEditReq(null), []);

  const selectProject = (id: string) => {
    projectIdRef.current = id;
    setSelectedProjectId(id);
    const first = allLists.find((l) => l.project_id === id) ?? null;
    listIdRef.current = first?.id ?? null;
    setActiveListId(first?.id ?? null);
    setSplitListId(null);
    setSelectedTaskId(null);
  };

  // ----- selection (per pane, keyed by the pane's list) -----
  const parentOf = useCallback(
    (id: string) => taskById[id]?.parent_id ?? null,
    [taskById]
  );
  const paneSelOf = (listId: string) => selByPane[listId] ?? EMPTY_SELECTION;
  const setPaneSelection = (
    listId: string,
    ids: Set<string>,
    anchor: string | null
  ) => setSelByPane((prev) => ({ ...prev, [listId]: { ids, anchor } }));
  const clearPaneSelection = (listId: string) =>
    setSelByPane((prev) => {
      if (!prev[listId]) return prev;
      const next = { ...prev };
      delete next[listId];
      return next;
    });

  // Bulk mutations act on a pane's current selection. Done/copy keep the
  // selection (non-destructive); move/delete clear it (the rows leave or vanish).
  const bulkSetDone = async (listId: string, done: boolean) => {
    const ids = [...paneSelOf(listId).ids];
    if (ids.length === 0) return;
    await api.setTasksDone(ids, done);
    await load();
  };

  const bulkCopy = (listId: string) => {
    const ids = [...paneSelOf(listId).ids];
    void copyTasksToClipboard(ids);
  };

  const bulkDelete = async (listId: string) => {
    const roots = collapseToRoots(paneSelOf(listId).ids, parentOf);
    if (roots.length === 0) return;
    const total = roots.reduce((n, id) => n + 1 + subtreeSize(id), 0);
    const ok = await confirmModal({
      danger: true,
      title: `Delete ${roots.length} task${roots.length === 1 ? '' : 's'}?`,
      message: `${total} task${total === 1 ? '' : 's'} (including subtasks) will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await api.deleteTasks(roots);
    clearPaneSelection(listId);
    await load();
  };

  // Move a set of already-collapsed roots (from a multi-drag payload) to the
  // root of `listId`, appended in the order given. Clears selections afterward.
  const dropSetOnRoot = async (ids: string[], listId: string) => {
    const idset = new Set(ids);
    const targetRoots = (rootsByList[listId] ?? []).filter(
      (t) => !idset.has(t.id)
    );
    const last = targetRoots[targetRoots.length - 1];
    const base = last ? effSort(last) + 1000 : 1000;
    await Promise.all(
      ids.map((id, i) => api.moveTask(id, null, listId, base + i * 1000))
    );
    setSelByPane({});
    await load();
  };

  // Drop a set of collapsed roots onto a row: nest under it, or land them as a
  // contiguous band in the target sibling group (full-group rebuild, mirroring
  // the single-drop rebalance so N items never collide on a midpoint).
  const dropSetOnRow = async (ids: string[], target: Task, zone: DropZone) => {
    if (ids.some((id) => isInSubtree(target.id, id))) return;
    const idset = new Set(ids);
    if (zone === 'nest') {
      const kids = (childrenByParent[target.id] ?? []).filter(
        (t) => !idset.has(t.id)
      );
      const last = kids[kids.length - 1];
      const base = last ? effSort(last) + 1000 : 1000;
      await Promise.all(
        ids.map((id, i) => api.moveTask(id, target.id, null, base + i * 1000))
      );
      setSelByPane({});
      await load();
      return;
    }
    const parentId = target.parent_id;
    const listArg = parentId ? null : target.list_id;
    const siblings = (
      parentId
        ? (childrenByParent[parentId] ?? [])
        : (rootsByList[target.list_id] ?? [])
    ).filter((t) => !idset.has(t.id));
    const targetIdx = siblings.findIndex((t) => t.id === target.id);
    const insertIdx = zone === 'before' ? targetIdx : targetIdx + 1;
    const ordered = [
      ...siblings.slice(0, insertIdx).map((t) => ({ id: t.id, dragged: false })),
      ...ids.map((id) => ({ id, dragged: true })),
      ...siblings.slice(insertIdx).map((t) => ({ id: t.id, dragged: false })),
    ];
    await Promise.all(
      ordered.map((x, i) =>
        x.dragged
          ? api.moveTask(x.id, parentId, listArg, (i + 1) * 1000)
          : api.reorderTask(x.id, (i + 1) * 1000)
      )
    );
    setSelByPane({});
    await load();
  };

  // ----- row context shared by both panes -----
  // The per-pane `mode`/selection is added by each TaskPane; this base holds
  // everything the two panes share.
  const ctx: BaseRowCtx = {
    childrenByParent,
    collapsed,
    toggleCollapsed: (id) =>
      setCollapsed((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectedTaskId,
    select: setSelectedTaskId,
    requestRename: beginTitleEdit,
    dropTarget,
    setDropTarget,
    draggingId,
    setDraggingId,
    composeFor,
    setComposeFor,
    isVisible,
    forceExpand: query.length > 0,
    otherLists: listsInProject,
    onToggleDone: toggleDone,
    onRequestDelete: requestDeleteTask,
    onMoveToList: (id, listId) => moveTask(id, null, listId),
    onPromote: (task) => moveTask(task.id, null, task.list_id),
    onCreateSubtask: createSubtask,
    onDropOnRow: dropOnRow,
    onDropSetOnRow: dropSetOnRow,
    onCopy: copyTasksToClipboard,
  };

  // Rows visible in a pane, in visual order — for arrow-key navigation.
  const flattenVisible = useCallback(
    (listId: string): Task[] => {
      const out: Task[] = [];
      const walk = (t: Task) => {
        out.push(t);
        if (query || !collapsed.has(t.id))
          for (const c of (childrenByParent[t.id] ?? []).filter(isVisible))
            walk(c);
      };
      for (const r of (rootsByList[listId] ?? []).filter(isVisible)) walk(r);
      return out;
    },
    [rootsByList, childrenByParent, isVisible, collapsed, query]
  );

  // The selection's forest roots in the pane's visual order — the multi-drag
  // payload and the operative set for bulk move (subtrees follow their roots).
  const selectionRootsOf = (listId: string): string[] => {
    const roots = new Set(collapseToRoots(paneSelOf(listId).ids, parentOf));
    if (roots.size === 0) return [];
    const ordered = flattenVisible(listId)
      .map((t) => t.id)
      .filter((id) => roots.has(id));
    // A root hidden under a collapsed (unselected) ancestor won't be in the flat
    // list; append it so the payload never silently drops a task.
    for (const id of roots) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  };

  // A row was clicked: plain = preview + reset selection (anchor here); ⌘ =
  // toggle membership; ⇧ = range from the anchor along the visual order.
  const onRowClick = (listId: string, id: string, mods: ClickMods) => {
    setPaneFocus(listId);
    setSelectedTaskId(id);
    const cur = paneSelOf(listId);
    if (mods.metaKey || mods.ctrlKey) {
      const ids = new Set(cur.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      setPaneSelection(listId, ids, id);
    } else if (mods.shiftKey && (cur.anchor || selectedTaskId)) {
      const anchor = cur.anchor ?? selectedTaskId!;
      const order = flattenVisible(listId).map((t) => t.id);
      setPaneSelection(listId, new Set(rangeBetween(order, anchor, id)), anchor);
    } else {
      // Plain click previews one row and drops the bulk selection (anchor kept
      // for a subsequent ⇧-range).
      setPaneSelection(listId, new Set(), id);
    }
  };

  const toggleSelectMember = (listId: string, id: string) => {
    setPaneFocus(listId);
    setSelectedTaskId(id);
    const ids = new Set(paneSelOf(listId).ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    setPaneSelection(listId, ids, id);
  };

  const selectAllVisible = (listId: string) => {
    const ids = flattenVisible(listId).map((t) => t.id);
    if (ids.length === 0) return;
    setPaneFocus(listId);
    setPaneSelection(listId, new Set(ids), selectedTaskId ?? ids[0]);
  };

  const bulkMove = async (listId: string, targetListId: string) => {
    const roots = selectionRootsOf(listId);
    if (roots.length === 0) return;
    const idset = new Set(roots);
    const targetRoots = (rootsByList[targetListId] ?? []).filter(
      (t) => !idset.has(t.id)
    );
    const last = targetRoots[targetRoots.length - 1];
    const base = last ? effSort(last) + 1000 : 1000;
    await Promise.all(
      roots.map((id, i) => api.moveTask(id, null, targetListId, base + i * 1000))
    );
    clearPaneSelection(listId);
    await load();
  };

  // Reorder the previewed task within its sibling group (⌘⌥↑/↓), reusing the
  // drag drop-math so the gap/rebalance logic stays in one place.
  const reorderSelected = (dir: -1 | 1) => {
    const t = selectedTask;
    if (!t) return;
    const sibs =
      (t.parent_id
        ? childrenByParent[t.parent_id]
        : rootsByList[t.list_id]) ?? [];
    const idx = sibs.findIndex((s) => s.id === t.id);
    const target = dir < 0 ? sibs[idx - 1] : sibs[idx + 1];
    if (!target) return;
    dropOnRow(t.id, target, dir < 0 ? 'before' : 'after');
  };

  const cycleTab = (dir: -1 | 1) => {
    const n = listsInProject.length;
    if (n === 0) return;
    const idx = listsInProject.findIndex((l) => l.id === focusedListId);
    const next = listsInProject[((idx < 0 ? 0 : idx) + dir + n) % n];
    if (next) selectList(next.id);
  };

  const cycleProject = (dir: -1 | 1) => {
    const n = projects.length;
    if (n === 0) return;
    const idx = projects.findIndex((p) => p.id === selectedProjectId);
    const next = projects[((idx < 0 ? 0 : idx) + dir + n) % n];
    if (next && next.id !== selectedProjectId) selectProject(next.id);
  };

  // A pane's selection API, bound to the list it shows. Rebuilt each render (as
  // `ctx` is), which is fine — rows already re-render on any App update.
  const makeSel = (listId: string): PaneSelection => ({
    ids: paneSelOf(listId).ids,
    onRowClick: (id, mods) => onRowClick(listId, id, mods),
    onToggleSelect: (id) => toggleSelectMember(listId, id),
    selectionRoots: () => selectionRootsOf(listId),
    selectAll: () => selectAllVisible(listId),
    clear: () => clearPaneSelection(listId),
    bulkSetDone: (done) => void bulkSetDone(listId, done),
    bulkMove: (target) => void bulkMove(listId, target),
    bulkCopy: () => bulkCopy(listId),
    bulkDelete: () => void bulkDelete(listId),
  });

  const registerComposer = useCallback(
    (listId: string, focus: ((seed?: string) => void) | null) => {
      if (focus) composers.current.set(listId, focus);
      else composers.current.delete(listId);
    },
    []
  );

  // The macOS "List" menu forwards its clicks here as events (it can't reach the
  // frontend dialog/clipboard itself). Re-subscribes when the active list changes
  // so Export always targets the list on screen.
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

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable;

      const pressed = (id: string) => matchesEvent(hotkeyMap[id] ?? '', e);

      if (pressed('search')) {
        e.preventDefault();
        searchFocusRef.current?.();
        return;
      }
      if (pressed('new_task')) {
        e.preventDefault();
        const target = focusedListId;
        if (target) composers.current.get(target)?.();
        return;
      }
      if (pressed('open_settings')) {
        e.preventDefault();
        api.openSettings();
        return;
      }
      if (pressed('toggle_preview')) {
        e.preventDefault();
        setPreviewOpen((v) => !v);
        return;
      }
      // Chorded navigation — safe to fire even while typing (⌘⌥/⌘⇧ combos don't
      // collide with text entry).
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
      if (!typing) {
        for (let i = 1; i <= 9; i++) {
          if (pressed(`switch_list_${i}`)) {
            const list = listsInProject[i - 1];
            if (list) {
              e.preventDefault();
              selectList(list.id);
            }
            return;
          }
        }
        if (pressed('select_all')) {
          if (focusedListId) {
            e.preventDefault();
            selectAllVisible(focusedListId);
          }
          return;
        }
        if (pressed('move_up') || pressed('move_down')) {
          e.preventDefault();
          reorderSelected(pressed('move_up') ? -1 : 1);
          return;
        }
        if (pressed('delete_task')) {
          const listId = focusedListId;
          if (listId && paneSelOf(listId).ids.size > 0) {
            e.preventDefault();
            void bulkDelete(listId);
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

      const scrollTo = (id: string) =>
        document
          .querySelector(`[data-task-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest' });

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const listId = focusedListId;
        if (!listId) return;
        const flat = flattenVisible(listId);
        if (flat.length === 0) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const idx = flat.findIndex((t) => t.id === selectedTaskId);
        if (e.shiftKey) {
          // Extend the selection to the neighbour (clamped at the ends).
          const nidx =
            idx < 0
              ? dir > 0
                ? 0
                : flat.length - 1
              : Math.min(Math.max(idx + dir, 0), flat.length - 1);
          const active = flat[nidx].id;
          const cur = paneSelOf(listId);
          const anchor = cur.anchor ?? selectedTaskId ?? active;
          const order = flat.map((t) => t.id);
          setPaneSelection(listId, new Set(rangeBetween(order, anchor, active)), anchor);
          setSelectedTaskId(active);
          scrollTo(active);
        } else {
          // Move the cursor (wrap at the ends), dropping any bulk selection.
          const nidx =
            idx < 0
              ? dir > 0
                ? 0
                : flat.length - 1
              : (idx + dir + flat.length) % flat.length;
          const active = flat[nidx].id;
          setPaneSelection(listId, new Set(), active);
          setSelectedTaskId(active);
          scrollTo(active);
        }
      } else if (e.key === 'ArrowLeft' && selectedTask) {
        const t = selectedTask;
        const kids = (childrenByParent[t.id] ?? []).filter(isVisible);
        if (kids.length > 0 && !collapsed.has(t.id) && !query) {
          e.preventDefault();
          setCollapsed((s) => new Set(s).add(t.id));
        } else if (t.parent_id && focusedListId) {
          e.preventDefault();
          setPaneSelection(focusedListId, new Set(), t.parent_id);
          setSelectedTaskId(t.parent_id);
          scrollTo(t.parent_id);
        }
      } else if (e.key === 'ArrowRight' && selectedTask) {
        const t = selectedTask;
        const kids = (childrenByParent[t.id] ?? []).filter(isVisible);
        if (kids.length === 0) return;
        e.preventDefault();
        if (collapsed.has(t.id) && !query) {
          setCollapsed((s) => {
            const n = new Set(s);
            n.delete(t.id);
            return n;
          });
        } else if (focusedListId) {
          const first = kids[0].id;
          setPaneSelection(focusedListId, new Set(), first);
          setSelectedTaskId(first);
          scrollTo(first);
        }
      } else if (e.key === ' ' && selectedTask) {
        e.preventDefault();
        toggleDone(selectedTask);
      } else if ((e.key === 'F2' || e.key === 'Enter') && selectedTask) {
        e.preventDefault();
        beginTitleEdit(selectedTask.id);
      } else if (e.key === 'Escape') {
        // A menu/dropdown is dismissing itself on this same Escape — don't also
        // clear the user's selection/preview. Otherwise clear the bulk selection
        // first, then (on a second press) the preview.
        if (overlayOpen()) return;
        const listId = focusedListId;
        if (listId && paneSelOf(listId).ids.size > 0) clearPaneSelection(listId);
        else setSelectedTaskId(null);
      } else if (
        e.key.length === 1 &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !overlayOpen()
      ) {
        // Type-to-capture: a printable key with nothing else consuming it drops
        // straight into the pane's composer, seeded with that character.
        const target = focusedListId;
        const composer = target ? composers.current.get(target) : undefined;
        if (composer) {
          e.preventDefault();
          composer(e.key);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The focused pane drives the preview: a >1 selection there shows the
  // multi-select inspector, otherwise the single-task inspector.
  const selectionTasks = focusedListId
    ? (() => {
        const ids = paneSelOf(focusedListId).ids;
        const inOrder = flattenVisible(focusedListId).filter((t) =>
          ids.has(t.id)
        );
        const seen = new Set(inOrder.map((t) => t.id));
        for (const id of ids)
          if (!seen.has(id) && taskById[id]) inOrder.push(taskById[id]);
        return inOrder;
      })()
    : [];
  const listNameById = (listId: string) =>
    allLists.find((l) => l.id === listId)?.name ?? null;

  // ----- layout -----
  return (
    <ContextMenuProvider>
      <div className="bg-surface-1l dark:bg-surface-1d text-content-1l dark:text-content-1d flex h-screen w-screen flex-col overflow-hidden">
        <TitleBar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={selectProject}
          onCreateProject={createProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          lists={listsInProject}
          activeListId={activeListId}
          splitListId={splitListId}
          focusedListId={focusedListId}
          counts={counts}
          onSelectList={selectList}
          onCreateList={createList}
          onRenameList={renameList}
          onDeleteList={deleteList}
          onExportList={exportList}
          onToggleSplit={toggleSplit}
          onDropTaskOnTab={(taskId, listId) => moveTask(taskId, null, listId)}
          onDropTaskSetOnTab={dropSetOnRoot}
          onReorderList={reorderList}
          search={search}
          onSearchChange={setSearch}
          registerSearch={registerSearch}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((v) => !v)}
          hotkeys={hotkeyMap}
        />

        <div className="flex min-h-0 flex-1">
          {activeList ? (
            <div className="flex min-w-0 flex-1">
              <div
                className="flex min-w-0"
                style={{
                  flexBasis: splitList ? `${splitRatio * 100}%` : '100%',
                }}
              >
                <TaskPane
                  list={activeList}
                  roots={rootsByList[activeList.id] ?? []}
                  ctx={ctx}
                  sel={makeSel(activeList.id)}
                  isSplit={false}
                  searching={query.length > 0}
                  onCreateTask={createTask}
                  onRootDrop={dropOnRoot}
                  onRootDropSet={dropSetOnRoot}
                  registerComposer={registerComposer}
                  onFocusPane={setPaneFocus}
                  captureHint={formatAccel(
                    hotkeyMap['toggle_capture_bar'] ?? ''
                  )}
                />
              </div>
              {splitList && (
                <>
                  <Resizer
                    onResize={(x, rect) =>
                      setSplitRatio(
                        Math.min(
                          0.75,
                          Math.max(0.25, (x - rect.left) / rect.width)
                        )
                      )
                    }
                  />
                  <div className="border-edge-2l dark:border-edge-2d flex min-w-0 flex-1 border-l">
                    <TaskPane
                      list={splitList}
                      roots={rootsByList[splitList.id] ?? []}
                      ctx={ctx}
                      sel={makeSel(splitList.id)}
                      isSplit
                      searching={query.length > 0}
                      onCloseSplit={() => setSplitListId(null)}
                      onCreateTask={createTask}
                      onRootDrop={dropOnRoot}
                      onRootDropSet={dropSetOnRoot}
                      registerComposer={registerComposer}
                      onFocusPane={setPaneFocus}
                      captureHint={formatAccel(
                        hotkeyMap['toggle_capture_bar'] ?? ''
                      )}
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

          {previewOpen && (
            <>
              <Resizer
                onResize={(x, rect) =>
                  setPreviewW(Math.min(420, Math.max(280, rect.right - x)))
                }
              />
              <aside
                style={{ width: previewW }}
                className="border-edge-2l dark:border-edge-2d shrink-0 border-l"
              >
                <PreviewPanel
                  task={selectedTask}
                  childrenByParent={childrenByParent}
                  listName={
                    selectedTask
                      ? (allLists.find((l) => l.id === selectedTask.list_id)
                          ?.name ?? null)
                      : null
                  }
                  projectName={
                    selectedTask
                      ? (projects.find(
                          (p) =>
                            p.id ===
                            allLists.find((l) => l.id === selectedTask.list_id)
                              ?.project_id
                        )?.name ?? null)
                      : null
                  }
                  onUpdateTask={updateTask}
                  onToggleDone={toggleDone}
                  onSelectTask={setSelectedTaskId}
                  onRequestDelete={requestDeleteTask}
                  onRefresh={load}
                  onClose={() => setPreviewOpen(false)}
                  titleEditReq={titleEditReq}
                  onTitleEditStarted={clearTitleEditReq}
                  selectionTasks={selectionTasks}
                  listNameById={listNameById}
                  moveTargets={listsInProject}
                  onBulkSetDone={
                    focusedListId
                      ? (done) => void bulkSetDone(focusedListId, done)
                      : undefined
                  }
                  onBulkMove={
                    focusedListId
                      ? (target) => void bulkMove(focusedListId, target)
                      : undefined
                  }
                  onBulkDelete={
                    focusedListId
                      ? () => void bulkDelete(focusedListId)
                      : undefined
                  }
                  onBulkCopy={
                    focusedListId ? () => bulkCopy(focusedListId) : undefined
                  }
                  onClearSelection={
                    focusedListId
                      ? () => clearPaneSelection(focusedListId)
                      : undefined
                  }
                  onOpenOne={(id) => {
                    if (focusedListId)
                      setPaneSelection(focusedListId, new Set(), id);
                    setSelectedTaskId(id);
                  }}
                />
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
    </ContextMenuProvider>
  );
}

/** Invisible grab strip over a hairline that brightens while resizing. The
 *  divider tracks the pointer's absolute position (via the parent's rect), so
 *  the cursor stays pinned to the line rather than drifting with accumulated
 *  deltas. */
function Resizer({
  onResize,
}: {
  onResize: (clientX: number, rect: DOMRect) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        setActive(true);
        const rect = (
          e.currentTarget.parentElement as HTMLElement
        ).getBoundingClientRect();
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
