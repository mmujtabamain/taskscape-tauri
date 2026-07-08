import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/TitleBar";
import { TaskPane } from "./components/TaskPane";
import { PreviewPanel } from "./components/PreviewPanel";
import { Spinner } from "./components/Spinner";
import { ContextMenuProvider } from "./components/ContextMenu";
import type { DropZone, RowCtx } from "./components/TaskRow";
import { confirmModal, promptName } from "./lib/modal";
import { suggestName } from "./lib/nameSuggest";
import { overlayOpen } from "./lib/overlays";
import { cmdKey } from "./lib/platform";
import { api, type List, type Project, type Task, type TaskPatch } from "./api";

const effSort = (t: Task) => t.sort_order || t.created_at;

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allLists, setAllLists] = useState<List[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [ready, setReady] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [splitListId, setSplitListId] = useState<string | null>(
    () => localStorage.getItem("ui.split") || null,
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(() => localStorage.getItem("ui.preview") !== "0");
  const [previewW, setPreviewW] = useState(() => Number(localStorage.getItem("ui.previewW")) || 320);
  const [splitRatio, setSplitRatio] = useState(() => Number(localStorage.getItem("ui.splitRatio")) || 0.5);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ taskId: string; zone: DropZone } | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
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
    const [fetchedProjects, lists, tasks, activeProject, activeList, showDone] = await Promise.all([
      api.listProjects(),
      api.listLists(),
      api.allTasks(),
      api.getSetting("last_active_project"),
      api.getSetting("last_active_list"),
      api.getSetting("show_completed"),
    ]);

    // A brand-new database has no projects yet — seed one so lists have a home.
    let nextProjects = fetchedProjects;
    if (nextProjects.length === 0) {
      nextProjects = [await api.defaultProject()];
    }

    setProjects(nextProjects);
    setAllLists(lists);
    setAllTasks(tasks);
    setShowCompleted(showDone !== "0");

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

    setSplitListId((s) => (s && s !== listId && inProject.some((l) => l.id === s) ? s : null));
    setSelectedTaskId((t) => (t && tasks.some((x) => x.id === t) ? t : null));
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reload when the tray process captures a task into the shared database.
  useEffect(() => {
    const un1 = listen("refresh", () => load());
    const un2 = listen("settings-changed", () => load());
    return () => {
      un1.then((fn) => fn());
      un2.then((fn) => fn());
    };
  }, [load]);

  // Remember the active project/list so we can restore them next launch, and so
  // tray captures land in the last-used list.
  useEffect(() => {
    if (selectedProjectId) api.setActiveProject(selectedProjectId).catch(() => {});
  }, [selectedProjectId]);
  useEffect(() => {
    if (activeListId) api.setActiveList(activeListId).catch(() => {});
  }, [activeListId]);

  useEffect(() => {
    if (splitListId) localStorage.setItem("ui.split", splitListId);
    else localStorage.removeItem("ui.split");
  }, [splitListId]);
  useEffect(() => {
    localStorage.setItem("ui.preview", previewOpen ? "1" : "0");
  }, [previewOpen]);
  useEffect(() => {
    localStorage.setItem("ui.previewW", String(previewW));
  }, [previewW]);
  useEffect(() => {
    localStorage.setItem("ui.splitRatio", String(splitRatio));
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
    [allLists, selectedProjectId],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of allTasks) {
      if (t.parent_id == null && !t.done) c[t.list_id] = (c[t.list_id] ?? 0) + 1;
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
      if (t.title.toLowerCase().includes(query) || t.notes?.toLowerCase().includes(query)) {
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
    [searchSet, showCompleted, hasPendingDesc],
  );

  const activeList = listsInProject.find((l) => l.id === activeListId) ?? null;
  const splitList = listsInProject.find((l) => l.id === splitListId) ?? null;
  const selectedTask = selectedTaskId ? (taskById[selectedTaskId] ?? null) : null;

  // ----- mutations -----
  const createProject = async () => {
    const name = await promptName({
      title: "New project",
      icon: "create_new_folder",
      placeholder: suggestName(),
    });
    if (!name) return;
    const project = await api.createProject(name);
    projectIdRef.current = project.id;
    listIdRef.current = null;
    await load();
  };

  const renameProject = async (project: Project) => {
    const name = await promptName({
      title: "Rename project",
      icon: "edit",
      initialValue: project.name,
      confirmLabel: "Rename",
    });
    if (!name || name === project.name) return;
    await api.renameProject(project.id, name);
    await load();
  };

  const deleteProject = async (project: Project) => {
    const listIds = allLists.filter((l) => l.project_id === project.id).map((l) => l.id);
    const taskCount = allTasks.filter((t) => listIds.includes(t.list_id)).length;
    const ok = await confirmModal({
      danger: true,
      title: `Delete “${project.name}”?`,
      message: `Its ${listIds.length} list${listIds.length === 1 ? "" : "s"} and ${taskCount} task${taskCount === 1 ? "" : "s"} are deleted with it. This cannot be undone.`,
      confirmLabel: "Delete project",
    });
    if (!ok) return;
    await api.deleteProject(project.id);
    if (project.id === projectIdRef.current) {
      projectIdRef.current = null;
      listIdRef.current = null;
    }
    await load();
  };

  const createList = async () => {
    if (!selectedProjectId) return;
    const name = await promptName({
      title: "New list",
      icon: "list_alt_add",
      placeholder: suggestName(),
    });
    if (!name) return;
    const list = await api.createList(selectedProjectId, name);
    listIdRef.current = list.id;
    await load();
  };

  const renameList = async (id: string, name: string) => {
    await api.renameList(id, name);
    await load();
  };

  // Tab reorder: rewrite every tab's sort_order to evenly spaced integers in the
  // new visual order. Lists are few, so a full rebuild is cheap and collision-free.
  const reorderList = async (draggedId: string, targetId: string, before: boolean) => {
    const dragged = listsInProject.find((l) => l.id === draggedId);
    const rest = listsInProject.filter((l) => l.id !== draggedId);
    const targetIdx = rest.findIndex((l) => l.id === targetId);
    if (!dragged || targetIdx < 0) return;
    const insertIdx = before ? targetIdx : targetIdx + 1;
    const ordered = [...rest.slice(0, insertIdx), dragged, ...rest.slice(insertIdx)];
    await Promise.all(ordered.map((l, i) => api.reorderList(l.id, (i + 1) * 1000)));
    await load();
  };

  const deleteList = async (list: List) => {
    const taskCount = allTasks.filter((t) => t.list_id === list.id).length;
    const ok = await confirmModal({
      danger: true,
      title: `Delete “${list.name}”?`,
      message:
        taskCount > 0
          ? `Its ${taskCount} task${taskCount === 1 ? "" : "s"} are deleted with it. This cannot be undone.`
          : "The list is empty. This cannot be undone.",
      confirmLabel: "Delete list",
    });
    if (!ok) return;
    await api.deleteList(list.id);
    if (list.id === listIdRef.current) listIdRef.current = null;
    await load();
  };

  const createTask = async (listId: string, title: string) => {
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
      const kids = childrenByParent[id] ?? [];
      return kids.reduce((n, k) => n + 1 + subtreeSize(k.id), 0);
    },
    [childrenByParent],
  );

  const requestDeleteTask = async (task: Task) => {
    const subs = subtreeSize(task.id);
    const ok = await confirmModal({
      danger: true,
      title: "Delete task?",
      message:
        `“${task.title}”` +
        (subs > 0 ? ` and its ${subs} subtask${subs === 1 ? "" : "s"}` : "") +
        " will be permanently deleted.",
      confirmLabel: "Delete",
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
    sortOrder?: number,
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
    [taskById],
  );

  const dropOnRow = async (draggedId: string, target: Task, zone: DropZone) => {
    if (isInSubtree(target.id, draggedId)) return;
    if (zone === "nest") {
      moveTask(draggedId, target.id, null);
      return;
    }
    const parentId = target.parent_id;
    const listArg = parentId ? null : target.list_id;
    const siblings = (
      parentId ? (childrenByParent[parentId] ?? []) : (rootsByList[target.list_id] ?? [])
    ).filter((t) => t.id !== draggedId);
    const targetIdx = siblings.findIndex((t) => t.id === target.id);
    const insertIdx = zone === "before" ? targetIdx : targetIdx + 1;
    const prev = siblings[insertIdx - 1];
    const next = siblings[insertIdx];

    // No gap between neighbors (equal timestamps, or midpoints exhausted after
    // many reorders): rebuild the whole group at evenly spaced integers with the
    // dragged task in its new slot, instead of trusting a colliding midpoint.
    if (prev && next && effSort(next) - effSort(prev) < 1) {
      const ordered = [...siblings.slice(0, insertIdx), null, ...siblings.slice(insertIdx)];
      await Promise.all(
        ordered.map((t, i) =>
          t ? api.reorderTask(t.id, (i + 1) * 1000) : api.moveTask(draggedId, parentId, listArg, (i + 1) * 1000),
        ),
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
    if (id === splitListId) {
      // Clicking the pinned list's tab swaps the two panes.
      setSplitListId(activeListId);
    }
    listIdRef.current = id;
    setActiveListId(id);
  };

  const toggleSplit = (id: string) => {
    setSplitListId((s) => (s === id ? null : id === activeListId ? s : id));
  };

  // ----- row context shared by both panes -----
  const ctx: RowCtx = {
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
    renamingId,
    requestRename: setRenamingId,
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
    onRename: (id, title) => updateTask(id, { title }),
    onRequestDelete: requestDeleteTask,
    onMoveToList: (id, listId) => moveTask(id, null, listId),
    onPromote: (task) => moveTask(task.id, null, task.list_id),
    onCreateSubtask: createSubtask,
    onDropOnRow: dropOnRow,
  };

  // Rows visible in a pane, in visual order — for arrow-key navigation.
  const flattenVisible = useCallback(
    (listId: string): Task[] => {
      const out: Task[] = [];
      const walk = (t: Task) => {
        out.push(t);
        if (query || !collapsed.has(t.id))
          for (const c of (childrenByParent[t.id] ?? []).filter(isVisible)) walk(c);
      };
      for (const r of (rootsByList[listId] ?? []).filter(isVisible)) walk(r);
      return out;
    },
    [rootsByList, childrenByParent, isVisible, collapsed, query],
  );

  const registerComposer = useCallback(
    (listId: string, focus: ((seed?: string) => void) | null) => {
      if (focus) composers.current.set(listId, focus);
      else composers.current.delete(listId);
    },
    [],
  );

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;

      if (cmdKey(e)) {
        if (e.key === "f") {
          e.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        }
        if (e.key === "n") {
          e.preventDefault();
          const target = selectedTask?.list_id ?? activeListId;
          if (target) composers.current.get(target)?.();
          return;
        }
        if (e.key === ",") {
          e.preventDefault();
          api.openSettings();
          return;
        }
        if (e.key === "\\") {
          e.preventDefault();
          setPreviewOpen((v) => !v);
          return;
        }
        if (!typing && e.key >= "1" && e.key <= "9") {
          const list = listsInProject[Number(e.key) - 1];
          if (list) {
            e.preventDefault();
            selectList(list.id);
          }
          return;
        }
        if (!typing && e.key === "Backspace" && selectedTask) {
          e.preventDefault();
          requestDeleteTask(selectedTask);
          return;
        }
      }

      if (typing) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const listId = selectedTask?.list_id ?? activeListId;
        if (!listId) return;
        const flat = flattenVisible(listId);
        if (flat.length === 0) return;
        e.preventDefault();
        const idx = flat.findIndex((t) => t.id === selectedTaskId);
        const next =
          e.key === "ArrowDown"
            ? flat[Math.min(idx + 1, flat.length - 1)]
            : flat[Math.max(idx - 1, 0)];
        setSelectedTaskId(next.id);
        document
          .querySelector(`[data-task-id="${CSS.escape(next.id)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      } else if (e.key === " " && selectedTask) {
        e.preventDefault();
        toggleDone(selectedTask);
      } else if ((e.key === "F2" || e.key === "Enter") && selectedTask) {
        e.preventDefault();
        setRenamingId(selectedTask.id);
      } else if (e.key === "Escape") {
        // A menu/dropdown is dismissing itself on this same Escape — don't also
        // clear the selection out from under the user.
        if (!overlayOpen()) setSelectedTaskId(null);
      } else if (
        e.key.length === 1 &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !overlayOpen()
      ) {
        // Type-to-capture: a printable key with nothing else consuming it drops
        // straight into the pane's composer, seeded with that character.
        const target = selectedTask?.list_id ?? activeListId;
        const composer = target ? composers.current.get(target) : undefined;
        if (composer) {
          e.preventDefault();
          composer(e.key);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ----- layout -----
  return (
    <ContextMenuProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-window text-ink">
        <TitleBar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={(id) => {
            projectIdRef.current = id;
            setSelectedProjectId(id);
            const first = allLists.find((l) => l.project_id === id) ?? null;
            listIdRef.current = first?.id ?? null;
            setActiveListId(first?.id ?? null);
            setSplitListId(null);
            setSelectedTaskId(null);
          }}
          onCreateProject={createProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          lists={listsInProject}
          activeListId={activeListId}
          splitListId={splitListId}
          counts={counts}
          onSelectList={selectList}
          onCreateList={createList}
          onRenameList={renameList}
          onDeleteList={deleteList}
          onToggleSplit={toggleSplit}
          onDropTaskOnTab={(taskId, listId) => moveTask(taskId, null, listId)}
          onReorderList={reorderList}
          search={search}
          onSearchChange={setSearch}
          searchRef={searchRef}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((v) => !v)}
        />

        <div className="flex min-h-0 flex-1">
          {activeList ? (
            <div className="flex min-w-0 flex-1">
              <div
                className="flex min-w-0"
                style={{ flexBasis: splitList ? `${splitRatio * 100}%` : "100%" }}
              >
                <TaskPane
                  list={activeList}
                  roots={rootsByList[activeList.id] ?? []}
                  ctx={ctx}
                  isSplit={false}
                  searching={query.length > 0}
                  onCreateTask={createTask}
                  onRootDrop={dropOnRoot}
                  registerComposer={registerComposer}
                />
              </div>
              {splitList && (
                <>
                  <Resizer
                    onResize={(x, rect) =>
                      setSplitRatio(
                        Math.min(0.75, Math.max(0.25, (x - rect.left) / rect.width)),
                      )
                    }
                  />
                  <div className="flex min-w-0 flex-1 border-l border-hairline">
                    <TaskPane
                      list={splitList}
                      roots={rootsByList[splitList.id] ?? []}
                      ctx={ctx}
                      isSplit
                      searching={query.length > 0}
                      onCloseSplit={() => setSplitListId(null)}
                      onCreateTask={createTask}
                      onRootDrop={dropOnRoot}
                      registerComposer={registerComposer}
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-content">
              <p className="font-display text-[17px] font-medium text-ink-2">No lists yet</p>
              <button
                onClick={createList}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold tracking-[0.01em] text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-active"
              >
                Create your first list
              </button>
            </div>
          )}

          {previewOpen && (
            <>
              <Resizer
                onResize={(x, rect) => setPreviewW(Math.min(420, Math.max(280, rect.right - x)))}
              />
              <aside style={{ width: previewW }} className="shrink-0 border-l border-hairline">
                <PreviewPanel
                  task={selectedTask}
                  childrenByParent={childrenByParent}
                  listName={selectedTask ? (allLists.find((l) => l.id === selectedTask.list_id)?.name ?? null) : null}
                  projectName={
                    selectedTask
                      ? (projects.find(
                          (p) =>
                            p.id === allLists.find((l) => l.id === selectedTask.list_id)?.project_id,
                        )?.name ?? null)
                      : null
                  }
                  onUpdateTask={updateTask}
                  onToggleDone={toggleDone}
                  onSelectTask={setSelectedTaskId}
                  onRequestDelete={requestDeleteTask}
                  onRefresh={load}
                  onClose={() => setPreviewOpen(false)}
                />
              </aside>
            </>
          )}
        </div>

        {!ready && (
          <div className="absolute inset-0 z-50 grid place-items-center bg-window">
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
function Resizer({ onResize }: { onResize: (clientX: number, rect: DOMRect) => void }) {
  const [active, setActive] = useState(false);
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        setActive(true);
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: MouseEvent) => onResize(ev.clientX, rect);
        const up = () => {
          setActive(false);
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      className="relative z-10 -mr-1.25 w-1.25 shrink-0 cursor-col-resize"
    >
      <span
        className={`absolute inset-y-0 left-0 w-px transition-colors ${
          active ? "bg-hairline-strong" : "bg-transparent hover:bg-hairline"
        }`}
      />
    </div>
  );
}

export default App;
