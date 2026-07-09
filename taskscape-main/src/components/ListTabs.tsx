import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useContextMenu } from "./ContextMenu";
import type { List } from "../api";

const TAB_MIME = "application/x-list-tab";

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
  onReorder: (draggedId: string, targetId: string, before: boolean) => void;
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
  onReorder,
}: Props) {
  const menu = useContextMenu();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const [tabOver, setTabOver] = useState<{ id: string; before: boolean } | null>(null);
  const activeIdx = lists.findIndex((l) => l.id === activeListId);
  const inSplit = splitListId != null;

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
        // The split indicator marks the two panes on screen — shown on BOTH the
        // active tab and the split tab, and only while split view is on.
        const paneDot = inSplit && (active || split);
        const tabDragOver = tabOver?.id === list.id;
        return (
          <div key={list.id} className="relative flex items-stretch">
            {!hideSep && <span className="my-auto h-4 w-px shrink-0 bg-edge-1l dark:bg-edge-1d" />}
            {tabDragOver && (
              <span
                className={`pointer-events-none absolute inset-y-1 z-10 w-[2px] rounded-full bg-accent-500l dark:bg-accent-500d ${
                  tabOver!.before ? "left-0" : "right-0"
                }`}
              />
            )}
            <div
              draggable={renaming !== list.id}
              className={`group relative flex cursor-default items-center gap-2 px-4 transition-colors ${
                active ? "bg-surface-2l dark:bg-surface-2d" : "hover:bg-wash-1l dark:hover:bg-wash-1d"
              } ${dropOver === list.id ? "bg-selection-1l dark:bg-selection-1d" : ""} ${
                draggingTab === list.id ? "opacity-40" : ""
              }`}
              onClick={() => onSelect(list.id)}
              onDoubleClick={() => setRenaming(list.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onDelete(list);
              }}
              onContextMenu={(e) => openMenu(e, list)}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, list.id);
                e.dataTransfer.effectAllowed = "move";
                setDraggingTab(list.id);
              }}
              onDragEnd={() => {
                setDraggingTab(null);
                setTabOver(null);
              }}
              onDragOver={(e) => {
                const types = e.dataTransfer.types;
                if (types.includes("application/x-task")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropOver(list.id);
                } else if (types.includes(TAB_MIME) && draggingTab !== list.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const before = e.clientX < r.left + r.width / 2;
                  setTabOver((v) =>
                    v?.id === list.id && v.before === before ? v : { id: list.id, before },
                  );
                }
              }}
              onDragLeave={() => {
                setDropOver((v) => (v === list.id ? null : v));
                setTabOver((v) => (v?.id === list.id ? null : v));
              }}
              onDrop={(e) => {
                const taskId = e.dataTransfer.getData("application/x-task");
                const tabId = e.dataTransfer.getData(TAB_MIME);
                setDropOver(null);
                const over = tabOver;
                setTabOver(null);
                if (taskId) {
                  e.preventDefault();
                  onDropTask(taskId, list.id);
                } else if (tabId && tabId !== list.id) {
                  e.preventDefault();
                  onReorder(tabId, list.id, over?.before ?? true);
                }
              }}
            >
              {active && (
                <>
                  {/* The notch: side hairlines run into the bar's bottom rule, which
                      breaks for the tab's width. */}
                  <span className="absolute inset-y-0 left-0 w-px bg-edge-2l dark:bg-edge-2d" />
                  <span className="absolute inset-y-0 right-0 w-px bg-edge-2l dark:bg-edge-2d" />
                  <span className="absolute inset-x-px -bottom-px h-px bg-surface-2l dark:bg-surface-2d" />
                </>
              )}
              {paneDot && <span className="size-1.5 shrink-0 rounded-full bg-accent-500l dark:bg-accent-500d" />}
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
                  className={`max-w-40 truncate text-[13px] tracking-[0.01em] ${
                    active ? "font-semibold text-content-1l dark:text-content-1d" : "font-medium text-content-2l dark:text-content-2d"
                  }`}
                >
                  {list.name}
                </span>
              )}
              <span className="relative grid w-4 place-items-center">
                <span className="text-[11.5px] font-semibold tracking-[0.02em] text-content-3l dark:text-content-3d tabular-nums group-hover:opacity-0">
                  {open}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(list);
                  }}
                  className="absolute inset-0 grid place-items-center rounded text-content-3l dark:text-content-3d opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:text-content-1l dark:hover:text-content-1d"
                  title="Delete list"
                >
                  <Icon name="close" size={15} weight={300} />
                </button>
              </span>
            </div>
          </div>
        );
      })}
      <button
        onClick={onCreate}
        className="my-auto ml-2 grid h-7 w-7 shrink-0 place-items-center rounded-md text-content-3l dark:text-content-3d transition-colors hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d"
        title="New list"
      >
        <Icon name="add" size={18} weight={300} />
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
      className="w-32 rounded bg-surface-0l dark:bg-surface-0d px-1.5 py-0.5 text-[13px] font-medium text-content-1l dark:text-content-1d outline-none"
    />
  );
}
