import { useState } from "react";
import { TaskItem } from "./TaskItem";
import { Icon } from "./Icon";
import type { List, Task, TaskPatch } from "../api";

interface Props {
  list: List | null;
  tasks: Task[];
  dragOverTaskId: string | null;
  onCreateTask: (title: string) => void;
  onUpdateTask: (id: string, patch: TaskPatch) => void;
  onDeleteTask: (id: string) => void;
  onRefresh: () => void;
}

export function TaskList({
  list,
  tasks,
  dragOverTaskId,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onRefresh,
}: Props) {
  const [draft, setDraft] = useState("");

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

  const remaining = tasks.filter((t) => !t.done).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-baseline gap-3 border-b border-zinc-200 px-8 py-5 dark:border-zinc-800">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{list.name}</h2>
        <span className="text-sm text-zinc-400">
          {remaining} open · {tasks.length} total
        </span>
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

      <div className="flex-1 space-y-2 overflow-y-auto px-8 py-5">
        {tasks.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-400">
            No tasks in this list yet.
          </p>
        ) : (
          tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              dragOver={task.id === dragOverTaskId}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
    </div>
  );
}
