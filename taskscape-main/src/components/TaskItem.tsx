import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icon";
import { api, type Task, type TaskPatch } from "../api";

interface Props {
  task: Task;
  dragOver?: boolean;
  onUpdate: (id: string, patch: TaskPatch) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

function dueToInputValue(due: number | null): string {
  if (due == null) return "";
  const d = new Date(due);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function inputValueToDue(v: string): number | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function formatDue(due: number): string {
  return new Date(due).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type DueState = "none" | "overdue" | "today" | "upcoming";
function dueState(due: number | null, done: boolean): DueState {
  if (due == null) return "none";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (!done && due < startToday) return "overdue";
  if (due < startToday + 86_400_000) return "today";
  return "upcoming";
}

const dueBadgeClass: Record<Exclude<DueState, "none">, string> = {
  overdue: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  today: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  upcoming: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function TaskItem({ task, dragOver, onUpdate, onDelete, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [refLocation, setRefLocation] = useState("");

  const ds = dueState(task.due_at, task.done);

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== task.title) onUpdate(task.id, { title: t });
    else setTitleDraft(task.title);
    setEditingTitle(false);
  };

  const commitNotes = () => {
    if (notesDraft !== (task.notes ?? "")) onUpdate(task.id, { notes: notesDraft });
  };

  const setDue = async (v: string) => {
    await api.setTaskDue(task.id, inputValueToDue(v));
    onRefresh();
  };

  const addReference = async () => {
    const loc = refLocation.trim();
    if (!loc) return;
    const name = loc.split(/[\\/]/).pop() || loc;
    await api.addReference(task.id, name, loc);
    setRefLocation("");
    onRefresh();
  };

  const addCopy = async () => {
    const picked = await open({ multiple: false, title: "Choose a file to copy" });
    if (typeof picked === "string") {
      await api.addCopy(task.id, picked);
      onRefresh();
    }
  };

  const removeAttachment = async (id: string) => {
    await api.deleteAttachment(id);
    onRefresh();
  };

  return (
    <div
      data-task-id={task.id}
      className={`rounded-xl border bg-white transition dark:bg-zinc-900 ${
        dragOver
          ? "border-indigo-400 ring-2 ring-indigo-400/60"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={() => onUpdate(task.id, { done: !task.done })}
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
            task.done
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-zinc-300 hover:border-indigo-500 dark:border-zinc-600"
          }`}
          title={task.done ? "Mark not done" : "Mark done"}
        >
          {task.done && <Icon name="check" size={14} weight={700} />}
        </button>

        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(task.title);
                setEditingTitle(false);
              }
            }}
            className="flex-1 rounded border border-indigo-400 bg-transparent px-2 py-0.5 text-sm outline-none dark:text-zinc-100"
          />
        ) : (
          <button
            onClick={() => setExpanded((v) => !v)}
            onDoubleClick={() => setEditingTitle(true)}
            className={`flex-1 truncate text-left text-sm ${
              task.done ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100"
            }`}
            title="Click to expand · double-click to rename"
          >
            {task.title}
          </button>
        )}

        {ds !== "none" && task.due_at != null && (
          <span
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${dueBadgeClass[ds]}`}
            title={ds === "overdue" ? "Overdue" : "Due"}
          >
            <Icon name="event" size={13} />
            {formatDue(task.due_at)}
          </span>
        )}

        {task.attachments.length > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-zinc-400" title="attachments">
            <Icon name="attach_file" size={14} />
            {task.attachments.length}
          </span>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="grid place-items-center rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title={expanded ? "Collapse" : "Expand"}
        >
          <Icon name="expand_more" size={18} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        <button
          onClick={() => onDelete(task.id)}
          className="grid place-items-center rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
          title="Delete task"
        >
          <Icon name="delete" size={16} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={commitNotes}
            placeholder="Notes…"
            rows={2}
            className="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />

          <div className="flex items-center gap-2 text-sm">
            <Icon name="event" size={16} className="text-zinc-400" />
            <span className="text-zinc-500 dark:text-zinc-400">Due</span>
            <input
              type="date"
              value={dueToInputValue(task.due_at)}
              onChange={(e) => setDue(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {task.due_at != null && (
              <button
                onClick={() => setDue("")}
                className="text-xs text-zinc-400 hover:text-red-500"
              >
                Clear
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {task.attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-sm dark:bg-zinc-800"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    a.link_type === "copy"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                  }`}
                >
                  {a.link_type}
                </span>
                <button
                  onClick={() => api.openAttachment(a)}
                  className="flex flex-1 items-center gap-1 truncate text-left text-zinc-700 hover:text-indigo-600 dark:text-zinc-200"
                  title={a.location}
                >
                  <span className="truncate">{a.name}</span>
                  <Icon name="open_in_new" size={13} className="shrink-0 opacity-50" />
                </button>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="grid place-items-center text-zinc-400 hover:text-red-500"
                  title="Remove attachment"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={refLocation}
              onChange={(e) => setRefLocation(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReference()}
              placeholder="Paste URL, file:// or network path…"
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              onClick={addReference}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Icon name="link" size={15} />
              Reference
            </button>
            <button
              onClick={addCopy}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <Icon name="upload_file" size={15} />
              Copy file…
            </button>
          </div>
          <p className="text-xs text-zinc-400">Tip: drag a file from Finder onto a task to attach a copy.</p>
        </div>
      )}
    </div>
  );
}
