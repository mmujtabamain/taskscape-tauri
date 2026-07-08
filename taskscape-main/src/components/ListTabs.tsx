import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useContextMenu } from "./ContextMenu";
import type { List } from "../api";

interface Props {
  lists: List[];
  activeListId: string | null;
  splitListId: string | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (list: List) => void;
  onToggleSplit: (id: string) => void;
  onDropTask: (taskId: string, listId: string) => void;
}

export function ListTabs({
  lists,
  activeListId,
  splitListId,
  counts,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onToggleSplit,
  onDropTask,
}: Props) {
  const menu = useContextMenu();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const activeIdx = lists.findIndex((l) => l.id === activeListId);

  const openMenu = (e: React.MouseEvent, list: List) => {
    e.preventDefault();
    menu.open({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: "rename", label: "Rename", icon: "edit" },
        {
          id: "split",
          label: list.id === splitListId ? "Close split" : "Open in split view",
          icon: "vertical_split",
          disabled: list.id === activeListId && list.id !== splitListId,
        },
        { id: "delete", label: "Delete list…", icon: "delete", danger: true, dividerAbove: true },
      ],
      onPick: (id) => {
        if (id === "rename") setRenaming(list.id);
        if (id === "split") onToggleSplit(list.id);
        if (id === "delete") onDelete(list);
      },
    });
  };

  return (
    <div
      className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto [&::-webkit-scrollbar]:hidden"
      data-no-drag
    >
      {lists.map((list, i) => {
        const active = list.id === activeListId;
        const split = list.id === splitListId;
        const open = counts[list.id] ?? 0;
        const hideSep = i === 0 || i === activeIdx || i - 1 === activeIdx;
        return (
          <div key={list.id} className="flex items-stretch">
            {!hideSep && <span className="my-auto h-4 w-px shrink-0 bg-hairline-faint" />}
            <div
              className={`group relative flex cursor-default items-center gap-1.5 px-3.5 transition-colors ${
                active ? "bg-content" : "hover:bg-wash"
              } ${dropOver === list.id ? "bg-selection" : ""}`}
              onClick={() => onSelect(list.id)}
              onDoubleClick={() => setRenaming(list.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onDelete(list);
              }}
              onContextMenu={(e) => openMenu(e, list)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-task")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropOver(list.id);
                }
              }}
              onDragLeave={() => setDropOver((v) => (v === list.id ? null : v))}
              onDrop={(e) => {
                const taskId = e.dataTransfer.getData("application/x-task");
                setDropOver(null);
                if (taskId) {
                  e.preventDefault();
                  onDropTask(taskId, list.id);
                }
              }}
            >
              {active && (
                <>
                  {/* The notch: side hairlines run into the bar's bottom rule, which
                      breaks for the tab's width. */}
                  <span className="absolute inset-y-0 left-0 w-px bg-hairline" />
                  <span className="absolute inset-y-0 right-0 w-px bg-hairline" />
                  <span className="absolute inset-x-px -bottom-px h-px bg-content" />
                </>
              )}
              {(active || split) && (
                <span
                  className={`h-[3px] w-[3px] shrink-0 rounded-full ${
                    active ? "bg-accent" : "border border-accent"
                  }`}
                />
              )}
              {renaming === list.id ? (
                <TabRenameInput
                  initial={list.name}
                  onDone={(name) => {
                    setRenaming(null);
                    if (name && name !== list.name) onRename(list.id, name);
                  }}
                />
              ) : (
                <span
                  className={`max-w-36 truncate text-[12px] tracking-[0.01em] ${
                    active ? "font-semibold text-ink" : "font-medium text-ink-2"
                  }`}
                >
                  {list.name}
                </span>
              )}
              <span className="relative grid w-4 place-items-center">
                <span
                  key={open}
                  className="animate-rise text-[10.5px] font-semibold tracking-[0.03em] text-ink-3 tabular-nums group-hover:opacity-0"
                >
                  {open}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(list);
                  }}
                  className="absolute inset-0 grid place-items-center rounded text-ink-3 opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:text-ink"
                  title="Delete list"
                >
                  <Icon name="close" size={13} weight={300} />
                </button>
              </span>
            </div>
          </div>
        );
      })}
      <button
        onClick={onCreate}
        className="my-auto ml-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-wash hover:text-ink"
        title="New list"
      >
        <Icon name="add" size={16} weight={300} />
      </button>
      {/* Trailing empty strip drags the window (the tabs themselves are interactive). */}
      <span data-tauri-drag-region className="min-w-6 flex-1 self-stretch" />
    </div>
  );
}

function TabRenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(ref.current?.value.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(ref.current?.value.trim() || null)}
      className="w-28 rounded bg-recessed px-1.5 py-0.5 text-[12px] font-medium text-ink outline-none"
    />
  );
}
