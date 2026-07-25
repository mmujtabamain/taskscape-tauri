import { cn } from '@taskscape/common-ui/cn';
import {
  Badge,
  IconButton,
  Label,
  TextInput,
} from '@taskscape/common-ui/components';
import { Icon } from '@taskscape/common-ui/Icon';
import { memo, useEffect, useRef, type ReactNode } from 'react';
import {
  beginTitleEdit,
  bulkDelete,
  bulkMove,
  bulkSetDone,
  copyToClipboard,
  createSubtask,
  requestDeleteTask,
  selectionRootsOf,
} from '../commands/tasks';
import { paneRowClick, paneToggleSelect } from '../lib/paneSelection';
import {
  dropOnRow as actDropOnRow,
  dropSetOnRow as actDropSetOnRow,
  move as actMove,
  toggleDone as actToggleDone,
} from '../stores/actions';
import { useAltPressed } from '../stores/altKeyStore';
import {
  beginTaskDrag,
  endTaskDrag,
  readDroppedIds,
  type DropZone,
} from '../stores/dragStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';
import { useSearchStore } from '../stores/searchStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';
import { useViewStore } from '../stores/viewStore';
import { isVisibleInPane, orderForPane } from '../stores/visibility';
import { useContextMenu, type MenuItem } from './contextMenuContext';
import { usePaneId } from './paneContext';

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

const INDENT = 24;

/** Everything a row reads from the stores, scoped to its pane. Co-located here so
 *  each row subscribes to just the slices it needs — with `React.memo` on the
 *  row, an unrelated update re-renders only the rows whose slices changed, not
 *  the whole forest. */
function useRowState(taskId: string) {
  const listId = usePaneId();
  const task = useTaskStore((s) => s.taskById[taskId]);
  const kids = useTaskStore((s) => s.childrenByParent[taskId]);
  // Subscribe (value unused) so a row re-derives its visible/ordered children
  // whenever the pane's sort/filter, completed toggle, or search changes.
  useViewStore((s) => s.byPane[listId]);
  useSettingsStore((s) => s.showCompleted);
  const query = useSearchStore((s) => s.byPane[listId]?.query ?? '');
  const searching = query.trim().length > 0;
  const collapsedHere = useLayoutStore((s) => s.collapsed.has(taskId));
  const picked = useSelectionStore(
    (s) => s.byPane[listId]?.ids.has(taskId) ?? false
  );
  const isPreview = useSelectionStore((s) => s.selectedTaskId === taskId);
  const dragging = useUiStore((s) => s.draggingId === taskId);
  const drop = useUiStore((s) =>
    s.dropTarget?.taskId === taskId ? s.dropTarget : null
  );

  const children = orderForPane(
    listId,
    (kids ?? []).filter((t) => isVisibleInPane(t, listId))
  );

  return {
    listId,
    task,
    children,
    expanded: searching || !collapsedHere,
    picked,
    selected: isPreview || picked,
    dragging,
    drop,
    query,
  };
}

function zoneFromEvent(e: React.DragEvent): DropZone {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (y < 0.3) return 'before';
  if (y > 0.7) return 'after';
  return 'nest';
}

export const TaskRow = memo(function TaskRow({
  taskId,
  depth,
}: {
  taskId: string;
  depth: number;
}) {
  const menu = useContextMenu();
  const composing = useUiStore((s) => s.composeFor === taskId);
  const {
    listId,
    task,
    children,
    expanded,
    picked,
    selected,
    dragging,
    drop,
    query,
  } = useRowState(taskId);

  if (!task) return null;

  const doneChildren = children.filter((c) => c.done).length;
  const nestHighlight = drop?.zone === 'nest';

  const toggleDone = () => void actToggleDone(task);

  const openMenu = (x: number, y: number) => {
    // Right-clicking a row inside a multi-selection acts on the whole set;
    // right-clicking any other row selects just it first (standard behaviour).
    const selectedIds = useSelectionStore.getState().paneSel(listId).ids;
    const n = selectedIds.size;
    const bulk = n >= 2 && selectedIds.has(task.id);
    if (bulk) useSelectionStore.getState().focus(task.id);
    else
      paneRowClick(listId, task.id, {
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
      });

    const otherLists = useListStore
      .getState()
      .listsInProject(useProjectStore.getState().activeId);
    const moveSubmenu = otherLists.map((l) => ({
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
            disabled: otherLists.length === 0,
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
            disabled: otherLists.length === 0,
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
        if (id === 'copy')
          void copyToClipboard(bulk ? [...selectedIds] : [task.id]);
        if (id === 'done') bulkSetDone(listId, true);
        if (id === 'undone') bulkSetDone(listId, false);
        if (id === 'subtask') useUiStore.getState().setComposeFor(task.id);
        if (id === 'rename') beginTitleEdit(task.id);
        if (id === 'promote') void actMove(task.id, null, task.list_id);
        if (id === 'delete') {
          if (bulk) void bulkDelete(listId);
          else void requestDeleteTask(task);
        }
        if (id.startsWith('move:')) {
          const target = id.slice(5);
          if (bulk) void bulkMove(listId, target);
          else void actMove(task.id, null, target);
        }
      },
    });
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
          const ids = useSelectionStore.getState().paneSel(listId).ids;
          const multi = ids.has(task.id) && ids.size > 1;
          beginTaskDrag(multi ? selectionRootsOf(listId) : [task.id]);
          e.dataTransfer.effectAllowed = 'move';
          useUiStore.getState().setDraggingId(task.id);
        }}
        onDragEnd={() => {
          endTaskDrag();
          useUiStore.getState().endDrag();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-task')) return;
          // Swallow the event even over the dragged row itself, so it never
          // bubbles to the pane's root-drop handler (which would un-nest it).
          e.preventDefault();
          e.stopPropagation();
          if (useUiStore.getState().draggingId === task.id) return;
          e.dataTransfer.dropEffect = 'move';
          const zone = zoneFromEvent(e);
          const cur = useUiStore.getState().dropTarget;
          if (cur?.taskId !== task.id || cur?.zone !== zone)
            useUiStore.getState().setDropTarget({ taskId: task.id, zone });
        }}
        onDragLeave={(e) => {
          if (
            !(e.currentTarget as HTMLElement).contains(
              e.relatedTarget as Node
            ) &&
            drop
          )
            useUiStore.getState().setDropTarget(null);
        }}
        onDrop={(e) => {
          const ids = readDroppedIds(e);
          useUiStore.getState().setDropTarget(null);
          if (ids.length === 0) return;
          // Consume the drop here (even a self-drop) so it can't fall through to
          // the pane's root-drop.
          e.preventDefault();
          e.stopPropagation();
          const zone = zoneFromEvent(e);
          if (ids.length > 1) {
            if (ids.includes(task.id)) return;
            void actDropSetOnRow(ids, task, zone);
            return;
          }
          if (ids[0] === task.id) return;
          void actDropOnRow(ids[0], task, zone);
        }}
        onMouseDown={(e) => {
          // Stop ⇧-click range-select from smearing a native text selection
          // across the rows it spans.
          if (e.shiftKey) e.preventDefault();
        }}
        onClick={(e) =>
          paneRowClick(listId, task.id, {
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
        className={cn(
          'group/row pr-space-6 relative flex min-h-9 items-center',
          selected
            ? 'bg-selection-1l dark:bg-selection-1d'
            : 'hover:bg-wash-1l dark:hover:bg-wash-1d',
          nestHighlight &&
            'rounded-field bg-selection-1l dark:bg-selection-1d ring-accent-500l dark:ring-accent-500d ring-1 ring-inset',
          dragging && 'opacity-40'
        )}
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
            className={cn(
              'z-raised bg-accent-500l dark:bg-accent-500d pointer-events-none absolute right-3 h-0.5',
              drop.zone === 'before' ? '-top-px' : '-bottom-px'
            )}
            style={{ left: depth * INDENT + 44 }}
          >
            <span className="bg-accent-500l dark:bg-accent-500d -left-space-2 absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" />
          </span>
        )}

        <div className="w-5" />

        <span className="grid w-6 shrink-0 place-items-center">
          <Check
            done={task.done}
            picked={picked}
            onToggleDone={toggleDone}
            onToggleSelect={() => paneToggleSelect(listId, task.id)}
          />
        </span>

        <div className="ml-space-6 py-space-5 min-w-0 flex-1">
          <Label
            as="div"
            truncate
            weight="medium"
            tone={task.done ? 'muted' : 'primary'}
            className="text-[14px] leading-4.75"
          >
            <span className={cn('strike', task.done && 'strike-on')}>
              {highlight(task.title, query)}
            </span>
          </Label>
          {task.notes && (
            <Label
              as="div"
              truncate
              tone={task.done ? 'muted' : 'secondary'}
              className={cn(
                'text-[12.5px] leading-4.25',
                task.done && 'opacity-55'
              )}
            >
              {highlight(task.notes, query)}
            </Label>
          )}
        </div>

        <div className="ml-space-6 gap-space-4 flex shrink-0 items-center">
          {/* Disclosure chevron, left of the checkbox in the gutter. */}
          {children.length > 0 && (
            <span className="grid w-5 shrink-0 place-items-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  useLayoutStore.getState().toggleCollapsed(task.id);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className={cn(
                  'rounded-field text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d grid h-5 w-5 place-items-center',
                  expanded
                    ? 'opacity-0 group-hover/row:opacity-100'
                    : 'opacity-100'
                )}
                title={expanded ? 'Collapse' : 'Expand'}
              >
                <Icon
                  name="chevron_left"
                  size={16}
                  weight={300}
                  className={cn(
                    'transition-transform duration-100',
                    expanded && '-rotate-90'
                  )}
                />
              </button>
            </span>
          )}
          {children.length > 0 && (
            <Badge
              className="px-space-3"
              title={`${doneChildren} of ${children.length} subtasks done`}
            >
              <span>{doneChildren}</span>
              <span>/</span>
              <span>{children.length}</span>
            </Badge>
          )}
          {task.attachments.length > 0 && (
            <Badge className="px-space-2">
              <Icon name="attach_file" size={13} weight={500} />
              <span className="pr-0.5">{task.attachments.length}</span>
            </Badge>
          )}
          <IconButton
            icon="more_horiz"
            iconSize={17}
            iconWeight={300}
            variant="ghostStrong"
            title="More"
            onClick={(e) => {
              e.stopPropagation();
              const r = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              openMenu(r.left, r.bottom + 4);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {(children.length > 0 || composing) && expanded && (
        <div className="relative">
          {children.map((child) => (
            <TaskRow key={child.id} taskId={child.id} depth={depth + 1} />
          ))}
          {composing && (
            <SubtaskComposer
              depth={depth + 1}
              onSubmit={(title) => void createSubtask(task.id, title)}
              onDismiss={() => useUiStore.getState().setComposeFor(null)}
            />
          )}
        </div>
      )}
    </div>
  );
});

/** One checkbox, two roles chosen by the Option key. By default it's a round
 *  select handle — click adds the row to the ambient selection, and a picked row
 *  fills accent with no check inside. Hold Option and it squares off into the
 *  done lamp: ghost check on hover, accent wipe + drawn stroke on check, instant
 *  cheap uncheck. The action follows the modifier live off the click, so it's
 *  always right even if the tracked hold state lags. */
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

  return (
    <button
      title={title}
      aria-pressed={active}
      className={cn(
        'group/check relative flex h-4.5 w-4.5 items-center justify-center overflow-hidden border-[1.5px]',
        doneMode ? 'rounded-field' : 'rounded-full',
        active
          ? 'border-done-lamp-1l dark:border-done-lamp-1d bg-done-lamp-1l dark:bg-done-lamp-1d'
          : 'border-edge-3l dark:border-edge-3d group-hover/row:border-content-3l dark:group-hover/row:border-content-3d'
      )}
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
          {done && <div className="size-full"></div>}
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
                !done ? 'opacity-0 group-hover/check:opacity-30' : undefined
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
      className="gap-space-4 pr-space-6 flex h-9 items-center"
      style={{ paddingLeft: depth * INDENT + 6 }}
    >
      <Icon
        name="subdirectory_arrow_right"
        size={15}
        weight={300}
        className="text-content-3l dark:text-content-3d"
      />
      <TextInput
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
        className="flex-1"
      />
    </div>
  );
}
