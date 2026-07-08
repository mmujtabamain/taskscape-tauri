import { useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import type { List, Task, TaskPatch } from "../api";

interface Props {
  list: List | null;
  tasks: Task[];
  loading: boolean;
  dragOverTaskId: string | null;
  onCreateTask: (title: string) => void;
  onCreateSubtask: (parentId: string, title: string) => void;
  onUpdateTask: (id: string, patch: TaskPatch) => void;
  onDeleteTask: (id: string) => void;
  onRefresh: () => void;
}

export function TaskList({
  list,
  tasks,
  loading,
  dragOverTaskId,
  onCreateTask,
  onCreateSubtask,
  onUpdateTask,
  onDeleteTask,
  onRefresh,
}: Props) {
  const [draft, setDraft] = useState("");

  // Group every task under its parent so each level can render its own subtasks.
  const childrenByParent = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (t.parent_id) (map[t.parent_id] ??= []).push(t);
    }
    return map;
  }, [tasks]);

  const roots = useMemo(() => tasks.filter((t) => t.parent_id == null), [tasks]);

  if (!list) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-zinc-400">
        Select or create a list to get started.
      </div>
    );
  }

  const submit = () => {
    const title = draft.trim();
    if (title) onCreateTask(title);
    setDraft("");
  };

  const remaining = roots.filter((t) => !t.done).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-baseline gap-3 border-b border-zinc-200 px-8 py-5 dark:border-zinc-800">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{list.name}</h2>
        <span className="text-sm text-zinc-400">
          {remaining} open · {roots.length} total
        </span>
        {loading && (
          <span className="ml-auto">
            <Spinner size={16} />
          </span>
        )}
      </header>

      <div className="px-8 pt-5">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 focus-within:border-indigo-400 dark:border-zinc-800 dark:bg-zinc-900">
          <Icon name="add" size={18} className="text-zinc-400" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Add a task and press Enter…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-8 py-5">
        {roots.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-400">No tasks in this list yet.</p>
        ) : (
          roots.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              childrenByParent={childrenByParent}
              dragOverTaskId={dragOverTaskId}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
              onCreateSubtask={onCreateSubtask}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
    </div>
  );
}
