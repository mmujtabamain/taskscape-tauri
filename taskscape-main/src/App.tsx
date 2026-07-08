import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { Spinner } from "./components/Spinner";
import { api, type List, type Project, type Task, type TaskPatch } from "./api";

/** Map a physical-pixel drop point to the task id under it, if any. */
function taskIdAt(pos: { x: number; y: number }): string | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
  return el?.closest("[data-task-id]")?.getAttribute("data-task-id") ?? null;
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allLists, setAllLists] = useState<List[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  // Refs mirror the current selection so `load` (a stable callback) can preserve
  // it across refreshes without going stale.
  const projectIdRef = useRef<string | null>(null);
  const listIdRef = useRef<string | null>(null);
  useEffect(() => {
    projectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);
  useEffect(() => {
    listIdRef.current = selectedListId;
  }, [selectedListId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedProjects, lists, tasks, activeProject, activeList] = await Promise.all([
        api.listProjects(),
        api.listLists(),
        api.allTasks(),
        api.getSetting("last_active_project"),
        api.getSetting("last_active_list"),
      ]);

      // A brand-new database has no projects yet — seed one so lists have a home.
      let nextProjects = fetchedProjects;
      if (nextProjects.length === 0) {
        nextProjects = [await api.defaultProject()];
      }

      setProjects(nextProjects);
      setAllLists(lists);
      setAllTasks(tasks);

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
      setSelectedListId(listId);
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reload when the tray process captures a task into the shared database.
  useEffect(() => {
    const unlisten = listen("refresh", () => load());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [load]);

  // Remember the active project/list so we can restore them next launch, and so
  // tray captures land in the last-used list.
  useEffect(() => {
    if (selectedProjectId) api.setActiveProject(selectedProjectId).catch(() => {});
  }, [selectedProjectId]);
  useEffect(() => {
    if (selectedListId) api.setActiveList(selectedListId).catch(() => {});
  }, [selectedListId]);

  // Drag a file from Finder onto a task row to attach it as a copy.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "over") {
          setDragOverTaskId(taskIdAt(p.position));
        } else if (p.type === "drop") {
          const taskId = taskIdAt(p.position);
          setDragOverTaskId(null);
          if (taskId && p.paths.length) {
            for (const path of p.paths) await api.addCopy(taskId, path);
            load();
          }
        } else {
          setDragOverTaskId(null);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [load]);

  const listsInProject = useMemo(
    () => allLists.filter((l) => l.project_id === selectedProjectId),
    [allLists, selectedProjectId],
  );

  // Sidebar counts reflect top-level tasks only (subtasks aren't counted twice).
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of allTasks) {
      if (t.parent_id == null) c[t.list_id] = (c[t.list_id] ?? 0) + 1;
    }
    return c;
  }, [allTasks]);

  const selectedList = useMemo(
    () => allLists.find((l) => l.id === selectedListId) ?? null,
    [allLists, selectedListId],
  );

  const tasks = useMemo(
    () => allTasks.filter((t) => t.list_id === selectedListId),
    [allTasks, selectedListId],
  );

  // project handlers
  const selectProject = (id: string) => {
    projectIdRef.current = id;
    setSelectedProjectId(id);
    const first = allLists.find((l) => l.project_id === id) ?? null;
    listIdRef.current = first?.id ?? null;
    setSelectedListId(first?.id ?? null);
  };
  const createProject = async (name: string) => {
    const project = await api.createProject(name);
    projectIdRef.current = project.id;
    listIdRef.current = null;
    await load();
  };
  const renameProject = async (id: string, name: string) => {
    await api.renameProject(id, name);
    await load();
  };
  const deleteProject = async (id: string) => {
    await api.deleteProject(id);
    if (id === projectIdRef.current) {
      projectIdRef.current = null;
      listIdRef.current = null;
    }
    await load();
  };

  // list handlers
  const createList = async (name: string) => {
    if (!selectedProjectId) return;
    const list = await api.createList(selectedProjectId, name);
    listIdRef.current = list.id;
    await load();
  };
  const renameList = async (id: string, name: string) => {
    await api.renameList(id, name);
    await load();
  };
  const deleteList = async (id: string) => {
    await api.deleteList(id);
    if (id === listIdRef.current) listIdRef.current = null;
    await load();
  };

  // task handlers
  const createTask = async (title: string) => {
    if (!selectedListId) return;
    await api.createTask(selectedListId, title);
    await load();
  };
  const createSubtask = async (parentId: string, title: string) => {
    const parent = allTasks.find((t) => t.id === parentId);
    if (!parent) return;
    await api.createTask(parent.list_id, title, undefined, parentId);
    await load();
  };
  const updateTask = async (id: string, patch: TaskPatch) => {
    await api.updateTask(id, patch);
    await load();
  };
  const deleteTask = async (id: string) => {
    await api.deleteTask(id);
    await load();
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={selectProject}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        lists={listsInProject}
        selectedListId={selectedListId}
        counts={counts}
        onSelectList={setSelectedListId}
        onCreateList={createList}
        onRenameList={renameList}
        onDeleteList={deleteList}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <TaskList
          list={selectedList}
          tasks={tasks}
          loading={loading}
          dragOverTaskId={dragOverTaskId}
          onCreateTask={createTask}
          onCreateSubtask={createSubtask}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onRefresh={load}
        />
      </main>

      {!ready && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-white dark:bg-zinc-950">
          <Spinner size={28} label="Loading…" />
        </div>
      )}
    </div>
  );
}

export default App;
