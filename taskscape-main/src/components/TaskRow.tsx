import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useContextMenu } from "./ContextMenu";
import { relativeTime, absoluteDateTime } from "../time";
import type { List, Task } from "../api";

export type DropZone = "before" | "after" | "nest";

export interface RowCtx {
  childrenByParent: Record<string, Task[]>;
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  selectedTaskId: string | null;
  select: (id: string) => void;
  renamingId: string | null;
  requestRename: (id: string | null) => void;
  dropTarget: { taskId: string; zone: DropZone } | null;
  setDropTarget: (t: { taskId: string; zone: DropZone } | null) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  composeFor: string | null;
  setComposeFor: (id: string | null) => void;
  isVisible: (t: Task) => boolean;
  forceExpand: boolean;
  otherLists: List[];
  onToggleDone: (task: Task) => void;
  onRename: (id: string, title: string) => void;
  onRequestDelete: (task: Task) => void;
  onMoveToList: (id: string, listId: string) => void;
  onPromote: (task: Task) => void;
  onCreateSubtask: (parentId: string, title: string) => void;
  onDropOnRow: (draggedId: string, target: Task, zone: DropZone) => void;
}

const INDENT = 24;

export function TaskRow({ task, depth, ctx }: { task: Task; depth: number; ctx: RowCtx }) {
  const menu = useContextMenu();
  const renaming = ctx.renamingId === task.id;
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const children = (ctx.childrenByParent[task.id] ?? []).filter(ctx.isVisible);
  const doneChildren = children.filter((c) => c.done).length;
  const expanded = ctx.forceExpand || !ctx.collapsed.has(task.id);
  const selected = ctx.selectedTaskId === task.id;
  const dragging = ctx.draggingId === task.id;
  const drop = ctx.dropTarget?.taskId === task.id ? ctx.dropTarget : null;
  const nestHighlight = drop?.zone === "nest";

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const toggleDone = () => {
    if (!task.done) {
      // The lamp lights amber for a beat, then settles to the warm-dim done state.
      setFlash(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(false), 340);
    } else {
      setFlash(false);
    }
    ctx.onToggleDone(task);
  };

  const openMenu = (x: number, y: number) => {
    ctx.select(task.id);
    menu.open({
      x,
      y,
      items: [
        { id: "subtask", label: "Add subtask", icon: "subdirectory_arrow_right" },
        { id: "rename", label: "Rename", icon: "edit" },
        {
          id: "move",
          label: "Move to list",
          icon: "arrow_forward",
          disabled: ctx.otherLists.length === 0,
          submenu: ctx.otherLists.map((l) => ({ id: `move:${l.id}`, label: l.name })),
        },
        ...(task.parent_id
          ? [{ id: "promote", label: "Promote to top level", icon: "north_west" }]
          : []),
        { id: "delete", label: "Delete task…", icon: "delete", danger: true, dividerAbove: true },
      ],
      onPick: (id) => {
        if (id === "subtask") ctx.setComposeFor(task.id);
        if (id === "rename") ctx.requestRename(task.id);
        if (id === "promote") ctx.onPromote(task);
        if (id === "delete") ctx.onRequestDelete(task);
        if (id.startsWith("move:")) ctx.onMoveToList(task.id, id.slice(5));
      },
    });
  };

  const zoneFromEvent = (e: React.DragEvent): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (y < 0.3) return "before";
    if (y > 0.7) return "after";
    return "nest";
  };

  return (
    <div>
      <div
        data-task-id={task.id}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-task", task.id);
          e.dataTransfer.effectAllowed = "move";
          ctx.setDraggingId(task.id);
        }}
        onDragEnd={() => {
          ctx.setDraggingId(null);
          ctx.setDropTarget(null);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("application/x-task")) return;
          // Swallow the event even over the dragged row itself, so it never
          // bubbles to the pane's root-drop handler (which would un-nest it).
          e.preventDefault();
          e.stopPropagation();
          if (ctx.draggingId === task.id) return;
          e.dataTransfer.dropEffect = "move";
          const zone = zoneFromEvent(e);
          if (drop?.zone !== zone || ctx.dropTarget?.taskId !== task.id)
            ctx.setDropTarget({ taskId: task.id, zone });
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && drop)
            ctx.setDropTarget(null);
        }}
        onDrop={(e) => {
          const draggedId = e.dataTransfer.getData("application/x-task");
          ctx.setDropTarget(null);
          if (!draggedId) return;
          // Consume the drop here (even a self-drop) so it can't fall through
          // to the pane's root-drop.
          e.preventDefault();
          e.stopPropagation();
          if (draggedId === task.id) return;
          ctx.onDropOnRow(draggedId, task, zoneFromEvent(e));
        }}
        onClick={() => ctx.select(task.id)}
        onDoubleClick={(e) => {
          if (renaming) return;
          e.stopPropagation();
          toggleDone();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        className={`group/row relative flex min-h-9 items-center pr-3 transition-colors duration-100 ${
          selected ? "bg-selection" : "hover:bg-wash"
        } ${nestHighlight ? "rounded-md bg-selection ring-1 ring-accent ring-inset" : ""} ${
          dragging ? "opacity-40" : ""
        }`}
        style={{ paddingLeft: depth * INDENT }}
      >
        {/* Inset row separator (starts at the text column, keeps the gutter clean). */}
        <span
          className="pointer-events-none absolute right-0 bottom-0 h-px bg-hairline-faint"
          style={{ left: depth * INDENT + 44 }}
        />

        {/* Drop indicator: amber line at target depth, with its index-dot terminal. */}
        {drop && drop.zone !== "nest" && (
          <span
            className={`pointer-events-none absolute right-3 z-10 h-[2px] bg-accent ${
              drop.zone === "before" ? "-top-px" : "-bottom-px"
            }`}
            style={{ left: depth * INDENT + 44 }}
          >
            <span className="absolute top-1/2 -left-[3px] h-[6px] w-[6px] -translate-y-1/2 rounded-full bg-accent" />
          </span>
        )}

        {/* Disclosure chevron, left of the checkbox in the gutter. */}
        <span className="grid w-5 shrink-0 place-items-center">
          {children.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                ctx.toggleCollapsed(task.id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`grid h-4 w-4 place-items-center rounded text-ink-3 transition-opacity hover:text-ink ${
                expanded ? "opacity-0 group-hover/row:opacity-100" : "opacity-100"
              }`}
              title={expanded ? "Collapse" : "Expand"}
            >
              <Icon
                name="chevron_right"
                size={14}
                weight={300}
                className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
              />
            </button>
          )}
        </span>

        <span className="grid w-6 shrink-0 place-items-center">
          <Check done={task.done} flashing={flash} onToggle={toggleDone} />
        </span>

        <div className="ml-2 min-w-0 flex-1 py-1.5">
          {renaming ? (
            <RenameInput
              initial={task.title}
              onDone={(title) => {
                ctx.requestRename(null);
                if (title && title !== task.title) ctx.onRename(task.id, title);
              }}
            />
          ) : (
            <div
              className={`truncate text-[13px] leading-[18px] font-medium ${
                task.done ? "strike strike-on text-ink-3" : "text-ink"
              }`}
            >
              {task.title}
            </div>
          )}
          {task.notes && (
            <div
              className={`truncate text-[12px] leading-4 ${
                task.done ? "text-ink-3 opacity-55" : "text-ink-2"
              }`}
            >
              {task.notes}
            </div>
          )}
        </div>

        <div
          className={`ml-2 flex shrink-0 items-center gap-2.5 ${task.done ? "opacity-55" : ""}`}
        >
          {!expanded && children.length > 0 && (
            <span className="text-[10.5px] font-semibold text-ink-3 tabular-nums">
              ({children.length})
            </span>
          )}
          {expanded && children.length > 0 && (
            <span
              className="text-[10.5px] font-semibold tracking-[0.02em] text-ink-3 tabular-nums"
              title={`${doneChildren} of ${children.length} subtasks done`}
            >
              {doneChildren}/{children.length}
            </span>
          )}
          {task.attachments.length > 0 && (
            <span className="flex h-[18px] items-center gap-1 rounded-[5px] border border-hairline px-1.5 text-[10.5px] font-semibold text-ink-3 tabular-nums">
              <Icon name="attach_file" size={12} weight={300} />
              {task.attachments.length}
            </span>
          )}
          <span
            className="text-[11px] tracking-[0.02em] text-ink-3 tabular-nums"
            title={`Created ${absoluteDateTime(task.created_at)}`}
          >
            {relativeTime(task.created_at)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openMenu(r.left, r.bottom + 4);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="grid h-5 w-5 place-items-center rounded text-ink-3 opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 hover:bg-wash-strong hover:text-ink"
            title="More"
          >
            <Icon name="more_horiz" size={15} weight={300} />
          </button>
        </div>
      </div>

      {(children.length > 0 || ctx.composeFor === task.id) && expanded && (
        <div className="relative">
          {/* Branch rail dropping from the parent's checkbox through its children. */}
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-hairline-faint"
            style={{ left: depth * INDENT + 42 }}
          />
          {children.map((child) => (
            <TaskRow key={child.id} task={child} depth={depth + 1} ctx={ctx} />
          ))}
          {ctx.composeFor === task.id && (
            <SubtaskComposer
              depth={depth + 1}
              onSubmit={(title) => ctx.onCreateSubtask(task.id, title)}
              onDismiss={() => ctx.setComposeFor(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The lamp well: ghost check on hover, amber wipe + drawn stroke on check,
 *  instant cheap uncheck (unchecking is error correction, never ceremony). */
function Check({ done, flashing, onToggle }: { done: boolean; flashing: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="group/check relative h-4 w-4 shrink-0 overflow-hidden rounded-[4px]"
      title={done ? "Mark not done" : "Mark done"}
    >
      <span
        className={`absolute inset-0 rounded-[4px] border-[1.5px] transition-colors duration-100 ${
          done ? "border-transparent" : "border-hairline-strong group-hover/row:border-ink-3"
        }`}
      />
      <span
        className={`absolute inset-0 ${flashing ? "bg-accent" : "bg-done-lamp"}`}
        style={{
          clipPath: done ? "inset(0 0 0 0)" : "inset(100% 0 0 0)",
          transition: done
            ? "clip-path 140ms cubic-bezier(0.2,0,0,1), background-color 150ms 240ms"
            : "clip-path 100ms cubic-bezier(0.3,0,1,1)",
        }}
      />
      <svg viewBox="0 0 12 12" className="absolute inset-0 m-auto h-3 w-3">
        <path
          d="M2.5 6.5 L5 8.8 L9.5 3.6"
          fill="none"
          stroke="var(--on-accent)"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={12}
          strokeDashoffset={done ? 0 : 12}
          style={{
            transition: done
              ? "stroke-dashoffset 160ms cubic-bezier(0.2,0,0,1) 80ms"
              : "stroke-dashoffset 80ms",
          }}
        />
      </svg>
      {!done && (
        <svg
          viewBox="0 0 12 12"
          className="absolute inset-0 m-auto h-3 w-3 opacity-0 transition-opacity duration-100 group-hover/check:opacity-30"
        >
          <path
            d="M2.5 6.5 L5 8.8 L9.5 3.6"
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
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
        e.stopPropagation();
        if (e.key === "Enter") onDone(ref.current?.value.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(ref.current?.value.trim() || null)}
      className="w-full rounded bg-recessed px-1.5 py-0.5 text-[13px] font-medium text-ink outline-none"
    />
  );
}

function SubtaskComposer({
  depth,
  onSubmit,
  onDismiss,
}: {
  depth: number;
  onSubmit: (title: string) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      className="flex h-8 items-center gap-2 pr-3"
      style={{ paddingLeft: depth * INDENT + 6 }}
    >
      <Icon name="subdirectory_arrow_right" size={14} weight={300} className="text-ink-3" />
      <input
        ref={ref}
        placeholder="Subtask title — Enter to add"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const title = (e.target as HTMLInputElement).value.trim();
            if (title) {
              onSubmit(title);
              (e.target as HTMLInputElement).value = "";
            } else onDismiss();
          }
          if (e.key === "Escape") onDismiss();
        }}
        onBlur={onDismiss}
        className="h-6 flex-1 rounded bg-recessed px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
      />
    </div>
  );
}
