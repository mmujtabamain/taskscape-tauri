import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { api, type List, type Task, type TaskPatch } from "./api";

/** Map a physical-pixel drop point to the task id under it, if any. */
function taskIdAt(pos: { x: number; y: number }): string | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
  return el?.closest("[data-task-id]")?.getAttribute("data-task-id") ?? null;
}

function App() {
  const [lists, setLists] = useState<List[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextLists, nextTasks] = await Promise.all([api.listLists(), api.allTasks()]);
    setLists(nextLists);
    setAllTasks(nextTasks);
    setSelectedId((cur) => cur ?? nextLists[0]?.id ?? null);
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

  // Remember the active list so tray captures land in it.
  useEffect(() => {
    if (selectedId) api.setActiveList(selectedId).catch(() => {});
  }, [selectedId]);

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

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of allTasks) c[t.list_id] = (c[t.list_id] ?? 0) + 1;
    return c;
  }, [allTasks]);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  const tasks = useMemo(
    () => allTasks.filter((t) => t.list_id === selectedId),
    [allTasks, selectedId],
  );

  // list handlers
  const createList = async (name: string) => {
    const list = await api.createList(name);
    setSelectedId(list.id);
    await load();
  };
  const renameList = async (id: string, name: string) => {
    await api.renameList(id, name);
    await load();
  };
  const deleteList = async (id: string) => {
    await api.deleteList(id);
    if (id === selectedId) setSelectedId(null);
    await load();
  };

  // task handlers
  const createTask = async (title: string) => {
    if (!selectedId) return;
    await api.createTask(selectedId, title);
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
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar
        lists={lists}
        selectedId={selectedId}
        counts={counts}
        onSelect={setSelectedId}
        onCreate={createList}
        onRename={renameList}
        onDelete={deleteList}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <TaskList
          list={selectedList}
          tasks={tasks}
          dragOverTaskId={dragOverTaskId}
          onCreateTask={createTask}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onRefresh={load}
        />
      </main>
    </div>
  );
}

export default App;
