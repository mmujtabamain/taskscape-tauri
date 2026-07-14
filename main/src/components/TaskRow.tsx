import { Icon } from '@taskscape/common-ui/Icon';
import { useEffect, useRef, type ReactNode } from 'react';
import type { List, Task } from '../api';
import { useAltPressed } from '../stores/altKeyStore';
import {
  beginTaskDrag,
  endTaskDrag,
  readDroppedIds,
} from '../stores/dragStore';
import { absoluteDateTime, relativeTime } from '../time';
import { useContextMenu, type MenuItem } from './contextMenuContext';

export type DropZone = 'before' | 'after' | 'nest';

/** Wrap case-insensitive matches of `query` in an accent `<mark>`. Text is plain
 *  (titles / notes preview), so this is injection-safe. */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let hit = lower.indexOf(needle);
  let key = 0;
  while (hit >= 0) {
    if (hit > i) out.push(text.slice(i, hit));
    out.push(
      <mark
        key={key++}
        className="bg-accent-500l/25 dark:bg-accent-500d/30 rounded-[3px] text-inherit"
      >
        {text.slice(hit, hit + needle.length)}
      </mark>
    );
    i = hit + needle.length;
    hit = lower.indexOf(needle, i);
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

/** Modifier keys that shape a row click: plain (select single), ⌘ (toggle),
 *  ⇧ (range from the anchor). */
export interface ClickMods {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface RowCtx {
  childrenByParent: Record<string, Task[]>;
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  selectedTaskId: string | null;
  /** Preview a task without touching the multi-selection. */
  select: (id: string) => void;
  /** This pane's ambient multi-selection (ids picked for bulk actions). */
  selectedIds: Set<string>;
  /** A row was clicked — apply plain / ⌘ / ⇧ semantics against the selection. */
  onRowClick: (id: string, mods: ClickMods) => void;
  /** The selection handle toggled a row's membership. */
  onToggleSelect: (id: string) => void;
  /** The selection's forest roots in visual order — the multi-drag payload. */
  selectionRoots: () => string[];
  /** Copy the given tasks to the clipboard as a Markdown checklist. */
  onCopy: (ids: string[]) => void;
  /** Bulk-set done on this pane's whole selection. */
  onBulkSetDone: (done: boolean) => void;
  /** Bulk-move this pane's selection to another list. */
  onBulkMove: (listId: string) => void;
  /** Delete this pane's whole selection (with confirmation). */
  onBulkDelete: () => void;
  requestRename: (id: string) => void;
  dropTarget: { taskId: string; zone: DropZone } | null;
  setDropTarget: (t: { taskId: string; zone: DropZone } | null) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  composeFor: string | null;
  setComposeFor: (id: string | null) => void;
  isVisible: (t: Task) => boolean;
  /** Order a sibling group by the pane's sort + direction (for rendering). */
  orderChildren: (tasks: Task[]) => Task[];
  forceExpand: boolean;
  /** Active search query for this pane, for highlighting matched text ('' = off). */
  query: string;
  otherLists: List[];
  onToggleDone: (task: Task) => void;
  onRequestDelete: (task: Task) => void;
  onMoveToList: (id: string, listId: string) => void;
  onPromote: (task: Task) => void;
  onCreateSubtask: (parentId: string, title: string) => void;
  onDropOnRow: (draggedId: string, target: Task, zone: DropZone) => void;
  onDropSetOnRow: (ids: string[], target: Task, zone: DropZone) => void;
}

/** The shared row context App builds once for both panes. Each `TaskPane`
 *  completes it into a full `RowCtx` by adding its own per-pane selection,
 *  visibility, and search-driven expansion. */
export type BaseRowCtx = Omit<
  RowCtx,
  | 'selectedIds'
  | 'onRowClick'
  | 'onToggleSelect'
  | 'selectionRoots'
  | 'onBulkSetDone'
  | 'onBulkMove'
  | 'onBulkDelete'
  | 'isVisible'
  | 'orderChildren'
  | 'forceExpand'
  | 'query'
>;

const INDENT = 24;

export function TaskRow({
  task,
  depth,
  ctx,
}: {
  task: Task;
  depth: number;
  ctx: RowCtx;
}) {
  const menu = useContextMenu();

  const children = ctx.orderChildren(
    (ctx.childrenByParent[task.id] ?? []).filter(ctx.isVisible)
  );
  const doneChildren = children.filter((c) => c.done).length;
  const expanded = ctx.forceExpand || !ctx.collapsed.has(task.id);
  const picked = ctx.selectedIds.has(task.id);
  // Highlight the preview-selected row and every picked row.
  const selected = ctx.selectedTaskId === task.id || picked;
  const dragging = ctx.draggingId === task.id;
  const drop = ctx.dropTarget?.taskId === task.id ? ctx.dropTarget : null;
  const nestHighlight = drop?.zone === 'nest';

  const toggleDone = () => {
    ctx.onToggleDone(task);
  };

  const openMenu = (x: number, y: number) => {
    // Right-clicking a row inside a multi-selection acts on the whole set;
    // right-clicking any other row selects just it first (standard behaviour).
    const n = ctx.selectedIds.size;
    const bulk = n >= 2 && ctx.selectedIds.has(task.id);
    if (bulk) ctx.select(task.id);
    else
      ctx.onRowClick(task.id, {
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
      });

    const moveSubmenu = ctx.otherLists.map((l) => ({
      id: `move:${l.id}`,
      label: l.name,
    }));
    const items: MenuItem[] = bulk
      ? [
          { id: 'copy', label: `Copy ${n} tasks`, icon: 'content_copy' },
          {
            id: 'done',
            label: `Mark ${n} done`,
            icon: 'task_alt',
            dividerAbove: true,
          },
          {
            id: 'undone',
            label: `Mark ${n} not done`,
            icon: 'radio_button_unchecked',
          },
          {
            id: 'move',
            label: 'Move to list',
            icon: 'arrow_forward',
            disabled: ctx.otherLists.length === 0,
            submenu: moveSubmenu,
          },
          {
            id: 'delete',
            label: `Delete ${n} tasks…`,
            icon: 'delete',
            danger: true,
            dividerAbove: true,
          },
        ]
      : [
          { id: 'copy', label: 'Copy', icon: 'content_copy' },
          {
            id: 'subtask',
            label: 'Add subtask',
            icon: 'subdirectory_arrow_right',
            dividerAbove: true,
          },
          { id: 'rename', label: 'Rename', icon: 'edit' },
          {
            id: 'move',
            label: 'Move to list',
            icon: 'arrow_forward',
            disabled: ctx.otherLists.length === 0,
            submenu: moveSubmenu,
          },
          ...(task.parent_id
            ? [
                {
                  id: 'promote',
                  label: 'Promote to top level',
                  icon: 'north_west',
                },
              ]
            : []),
          {
            id: 'delete',
            label: 'Delete task…',
            icon: 'delete',
            danger: true,
            dividerAbove: true,
          },
        ];
    menu.open({
      x,
      y,
      items,
      onPick: (id) => {
        if (id === 'copy') ctx.onCopy(bulk ? [...ctx.selectedIds] : [task.id]);
        if (id === 'done') ctx.onBulkSetDone(true);
        if (id === 'undone') ctx.onBulkSetDone(false);
        if (id === 'subtask') ctx.setComposeFor(task.id);
        if (id === 'rename') ctx.requestRename(task.id);
        if (id === 'promote') ctx.onPromote(task);
        if (id === 'delete') {
          if (bulk) ctx.onBulkDelete();
          else ctx.onRequestDelete(task);
        }
        if (id.startsWith('move:')) {
          const listId = id.slice(5);
          if (bulk) ctx.onBulkMove(listId);
          else ctx.onMoveToList(task.id, listId);
        }
      },
    });
  };

  const zoneFromEvent = (e: React.DragEvent): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (y < 0.3) return 'before';
    if (y > 0.7) return 'after';
    return 'nest';
  };

  return (
    <div>
      <div
        data-task-id={task.id}
        draggable
        onDragStart={(e) => {
          // The primary id rides on the DataTransfer for drop-target detection
          // and single-drag fallback; the actual id set (whole selection when
          // this row is part of it, else just this row) travels in the drag
          // store, which WKWebView carries reliably where a 2nd MIME type won't.
          e.dataTransfer.setData('application/x-task', task.id);
          const multi =
            ctx.selectedIds.has(task.id) && ctx.selectedIds.size > 1;
          beginTaskDrag(multi ? ctx.selectionRoots() : [task.id]);
          e.dataTransfer.effectAllowed = 'move';
          ctx.setDraggingId(task.id);
        }}
        onDragEnd={() => {
          endTaskDrag();
          ctx.setDraggingId(null);
          ctx.setDropTarget(null);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-task')) return;
          // Swallow the event even over the dragged row itself, so it never
          // bubbles to the pane's root-drop handler (which would un-nest it).
          e.preventDefault();
          e.stopPropagation();
          if (ctx.draggingId === task.id) return;
          e.dataTransfer.dropEffect = 'move';
          const zone = zoneFromEvent(e);
          if (drop?.zone !== zone || ctx.dropTarget?.taskId !== task.id)
            ctx.setDropTarget({ taskId: task.id, zone });
        }}
        onDragLeave={(e) => {
          if (
            !(e.currentTarget as HTMLElement).contains(
              e.relatedTarget as Node
            ) &&
            drop
          )
            ctx.setDropTarget(null);
        }}
        onDrop={(e) => {
          const ids = readDroppedIds(e);
          ctx.setDropTarget(null);
          if (ids.length === 0) return;
          // Consume the drop here (even a self-drop) so it can't fall through
          // to the pane's root-drop.
          e.preventDefault();
          e.stopPropagation();
          const zone = zoneFromEvent(e);
          if (ids.length > 1) {
            if (ids.includes(task.id)) return;
            ctx.onDropSetOnRow(ids, task, zone);
            return;
          }
          if (ids[0] === task.id) return;
          ctx.onDropOnRow(ids[0], task, zone);
        }}
        onMouseDown={(e) => {
          // Stop ⇧-click range-select from smearing a native text selection
          // across the rows it spans.
          if (e.shiftKey) e.preventDefault();
        }}
        onClick={(e) =>
          ctx.onRowClick(task.id, {
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
          })
        }
        onDoubleClick={(e) => {
          e.stopPropagation();
          toggleDone();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        className={`group/row relative flex min-h-10 items-center pr-3 transition-colors duration-75 ${
          selected
            ? 'bg-selection-1l dark:bg-selection-1d'
            : 'hover:bg-wash-1l dark:hover:bg-wash-1d'
        } ${nestHighlight ? 'rounded-field bg-selection-1l dark:bg-selection-1d ring-accent-500l dark:ring-accent-500d ring-1 ring-inset' : ''} ${
          dragging ? 'opacity-40' : ''
        }`}
        style={{ paddingLeft: depth * INDENT }}
      >
        {/* Inset row separator (starts at the text column, keeps the gutter clean). */}
        <span
          className="bg-edge-1l dark:bg-edge-1d pointer-events-none absolute right-0 bottom-0 h-px"
          style={{ left: depth * INDENT + 44 }}
        />

        {/* Drop indicator: accent line at target depth, with its index-dot terminal. */}
        {drop && drop.zone !== 'nest' && (
          <span
            className={`z-raised bg-accent-500l dark:bg-accent-500d pointer-events-none absolute right-3 h-0.5 ${
              drop.zone === 'before' ? '-top-px' : '-bottom-px'
            }`}
            style={{ left: depth * INDENT + 44 }}
          >
            <span className="bg-accent-500l dark:bg-accent-500d absolute top-1/2 -left-0.75 h-1.5 w-1.5 -translate-y-1/2 rounded-full" />
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
              className={`rounded-field text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d grid h-5 w-5 place-items-center transition-opacity ${
                expanded
                  ? 'opacity-0 group-hover/row:opacity-100'
                  : 'opacity-100'
              }`}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              <Icon
                name="chevron_right"
                size={16}
                weight={300}
                className={`transition-transform duration-100 ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
          )}
        </span>

        <span className="grid w-6 shrink-0 place-items-center">
          <Check
            done={task.done}
            picked={picked}
            onToggleDone={toggleDone}
            onToggleSelect={() => ctx.onToggleSelect(task.id)}
          />
        </span>

        <div className="ml-2.5 min-w-0 flex-1 py-2">
          <div
            className={`truncate text-[14px] leading-4.75 font-medium ${
              task.done
                ? 'strike strike-on text-content-3l dark:text-content-3d'
                : 'text-content-1l dark:text-content-1d'
            }`}
          >
            {highlight(task.title, ctx.query)}
          </div>
          {task.notes && (
            <div
              className={`truncate text-[12.5px] leading-4.25 ${
                task.done
                  ? 'text-content-3l dark:text-content-3d opacity-55'
                  : 'text-content-2l dark:text-content-2d'
              }`}
            >
              {highlight(task.notes, ctx.query)}
            </div>
          )}
        </div>

        <div
          className={`ml-2.5 flex shrink-0 items-center gap-2.5 ${task.done ? 'opacity-55' : ''}`}
        >
          {!expanded && children.length > 0 && (
            <span className="text-content-3l dark:text-content-3d text-[11px] font-semibold tabular-nums">
              ({children.length})
            </span>
          )}
          {expanded && children.length > 0 && (
            <span
              className="text-content-3l dark:text-content-3d text-[11px] font-semibold tracking-[0.02em] tabular-nums"
              title={`${doneChildren} of ${children.length} subtasks done`}
            >
              {doneChildren}/{children.length}
            </span>
          )}
          {task.attachments.length > 0 && (
            <span className="rounded-field border-edge-2l dark:border-edge-2d text-content-3l dark:text-content-3d flex h-5 items-center gap-1 border px-1.5 text-[11px] font-semibold tabular-nums">
              <Icon name="attach_file" size={13} weight={300} />
              {task.attachments.length}
            </span>
          )}
          <span
            className="text-content-3l dark:text-content-3d text-[11.5px] tracking-[0.02em] tabular-nums"
            title={`Created ${absoluteDateTime(task.created_at)}`}
          >
            {relativeTime(task.created_at)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              ctx.setComposeFor(task.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 place-items-center opacity-0 transition-opacity duration-100 group-hover/row:opacity-100"
            title="Add subtask"
          >
            <Icon name="add" size={17} weight={300} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const r = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              openMenu(r.left, r.bottom + 4);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 place-items-center opacity-0 transition-opacity duration-100 group-hover/row:opacity-100"
            title="More"
          >
            <Icon name="more_horiz" size={17} weight={300} />
          </button>
        </div>
      </div>

      {(children.length > 0 || ctx.composeFor === task.id) && expanded && (
        <div className="relative">
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

/** One checkbox, two roles chosen by the Option key. By default it's a round
 *  select handle — click adds the row to the ambient selection, and a picked row
 *  fills accent with no check inside. Hold Option and it squares off into the
 *  done lamp: ghost check on hover, accent wipe + drawn stroke on check, instant
 *  cheap uncheck (unchecking is error correction, never ceremony). The action
 *  follows the modifier live off the click, so it's always right even if the
 *  tracked hold state lags. */
function Check({
  done,
  picked,
  onToggleDone,
  onToggleSelect,
}: {
  done: boolean;
  picked: boolean;
  onToggleDone: () => void;
  onToggleSelect: () => void;
}) {
  const alt = useAltPressed();

  const doneMode = alt;
  const active = doneMode ? done : picked;

  const title = doneMode
    ? done
      ? 'Mark not done'
      : 'Mark done'
    : picked
      ? 'Deselect'
      : 'Select';

  const shape = doneMode ? 'rounded-field' : 'rounded-full';

  return (
    <button
      title={title}
      aria-pressed={active}
      className={`group/check relative flex h-4.5 w-4.5 items-center justify-center overflow-hidden ${shape} border-[1.5px] ${
        active
          ? 'border-done-lamp-1l dark:border-done-lamp-1d bg-done-lamp-1l dark:bg-done-lamp-1d'
          : 'border-edge-3l dark:border-edge-3d group-hover/row:border-content-3l dark:group-hover/row:border-content-3d'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        if (e.altKey) return onToggleDone();
        onToggleSelect();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Selection indicator */}
      {!doneMode && picked && (
        <span className="bg-content-1d size-2 rounded-full" />
      )}

      {/* Done fill */}
      {doneMode && (
        <>
          {done && (
            <div className=" size-full"></div>
          )}
          {/* Animated check */}
          <svg
            viewBox="0 0 12 12"
            className="absolute inset-0 m-auto h-3.5 w-3.5"
          >
            <path
              d="M2.5 6.5 L5 8.8 L9.5 3.6"
              fill="none"
              stroke={done ? 'var(--on-accent)' : 'var(--content-3)'}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={12}
              strokeDashoffset={done ? 0 : 12}
              opacity={done ? 1 : undefined}
              className={
                !done
                  ? 'opacity-0 transition-opacity duration-100 group-hover/check:opacity-30'
                  : undefined
              }
              style={{
                transition: done
                  ? 'stroke-dashoffset 160ms cubic-bezier(0.2,0,0,1) 80ms'
                  : 'stroke-dashoffset 80ms',
              }}
            />
          </svg>
        </>
      )}
    </button>
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
      className="flex h-9 items-center gap-2 pr-3"
      style={{ paddingLeft: depth * INDENT + 6 }}
    >
      <Icon
        name="subdirectory_arrow_right"
        size={15}
        weight={300}
        className="text-content-3l dark:text-content-3d"
      />
      <input
        ref={ref}
        placeholder="Subtask title — Enter to add"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            const title = (e.target as HTMLInputElement).value.trim();
            if (title) {
              onSubmit(title);
              (e.target as HTMLInputElement).value = '';
            } else onDismiss();
          }
          if (e.key === 'Escape') onDismiss();
        }}
        onBlur={onDismiss}
        className="rounded-field bg-surface-0l dark:bg-surface-0d text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d h-7 flex-1 px-2.5 text-[13px] outline-none"
      />
    </div>
  );
}
