import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { api, type List, type Task, type TaskPatch } from "./api";

function App() {
  const [lists, setLists] = useState<List[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
