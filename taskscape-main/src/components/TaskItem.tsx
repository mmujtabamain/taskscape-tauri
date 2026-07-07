import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Task, type TaskPatch } from "../api";

interface Props {
  task: Task;
  onUpdate: (id: string, patch: TaskPatch) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

export function TaskItem({ task, onUpdate, onDelete, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [refLocation, setRefLocation] = useState("");

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== task.title) onUpdate(task.id, { title: t });
    else setTitleDraft(task.title);
    setEditingTitle(false);
  };

  const commitNotes = () => {
    if (notesDraft !== (task.notes ?? "")) onUpdate(task.id, { notes: notesDraft });
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
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
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
          {task.done && <CheckIcon />}
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

        {task.attachments.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-zinc-400" title="attachments">
            <PaperclipIcon />
            {task.attachments.length}
          </span>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title={expanded ? "Collapse" : "Expand"}
        >
          <ChevronIcon open={expanded} />
        </button>
        <button
          onClick={() => onDelete(task.id)}
          className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
          title="Delete task"
        >
          <TrashIcon />
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
                  className="flex-1 truncate text-left text-zinc-700 hover:text-indigo-600 dark:text-zinc-200"
                  title={a.location}
                >
                  {a.name}
                </button>
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="text-zinc-400 hover:text-red-500"
                  title="Remove attachment"
                >
                  <TrashIcon />
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
              className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Reference
            </button>
            <button
              onClick={addCopy}
              className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Copy file…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}
