import { useState } from "react";
import type { List } from "../api";

interface Props {
  lists: List[];
  selectedId: string | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({
  lists,
  selectedId,
  counts,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const submitNew = () => {
    const name = draft.trim();
    if (name) onCreate(name);
    setDraft("");
    setAdding(false);
  };

  const submitEdit = (id: string) => {
    const name = editDraft.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          T
        </div>
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Taskscape</h1>
      </div>

      <div className="flex items-center justify-between px-5 pb-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Lists</span>
        <button
          onClick={() => setAdding(true)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="New list"
        >
          <PlusIcon />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {lists.map((list) => {
          const active = list.id === selectedId;
          if (editingId === list.id) {
            return (
              <input
                key={list.id}
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={() => submitEdit(list.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitEdit(list.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="w-full rounded-lg border border-indigo-400 bg-white px-3 py-1.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
              />
            );
          }
          return (
            <div
              key={list.id}
              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                active
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <button
                onClick={() => onSelect(list.id)}
                onDoubleClick={() => {
                  setEditingId(list.id);
                  setEditDraft(list.name);
                }}
                className="flex-1 truncate text-left"
                title={list.name}
              >
                {list.name}
              </button>
              <span
                className={`text-xs tabular-nums ${
                  active ? "text-indigo-200" : "text-zinc-400"
                }`}
              >
                {counts[list.id] ?? 0}
              </span>
              <button
                onClick={() => {
                  if (confirm(`Delete list "${list.name}" and all its tasks?`)) onDelete(list.id);
                }}
                className={`opacity-0 group-hover:opacity-100 ${
                  active ? "text-indigo-200 hover:text-white" : "text-zinc-400 hover:text-red-500"
                }`}
                title="Delete list"
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}

        {adding && (
          <input
            autoFocus
            value={draft}
            placeholder="List name…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitNew}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            className="w-full rounded-lg border border-indigo-400 bg-white px-3 py-1.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
        )}

        {lists.length === 0 && !adding && (
          <p className="px-3 py-6 text-center text-xs text-zinc-400">
            No lists yet. Click + to create one.
          </p>
        )}
      </nav>
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
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
