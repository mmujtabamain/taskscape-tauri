import { useEffect, useMemo, useRef, useState } from 'react';
import type { List, Task } from '../api';
import { Icon } from '@taskscape/common-ui/Icon';
import { useContextMenu } from './contextMenuContext';
import {
  TaskRow,
  type BaseRowCtx,
  type ClickMods,
  type RowCtx,
  TASK_SET_MIME,
} from './TaskRow';

/** Per-pane selection state + actions, built by App and injected here. Split
 *  panes each get their own so they select independently. */
export interface PaneSelection {
  ids: Set<string>;
  onRowClick: (id: string, mods: ClickMods) => void;
  onToggleSelect: (id: string) => void;
  selectionRoots: () => string[];
  selectAll: () => void;
  clear: () => void;
  bulkSetDone: (done: boolean) => void;
  bulkMove: (listId: string) => void;
  bulkCopy: () => void;
  bulkDelete: () => void;
}

interface Props {
  list: List;
  roots: Task[];
  ctx: BaseRowCtx;
  sel: PaneSelection;
  isSplit: boolean;
  searching: boolean;
  onCloseSplit?: () => void;
  onCreateTask: (listId: string, title: string) => void;
  onRootDrop: (draggedId: string, listId: string) => void;
  onRootDropSet: (ids: string[], listId: string) => void;
  registerComposer: (
    listId: string,
    focus: ((seed?: string) => void) | null
  ) => void;
  onFocusPane: (listId: string) => void;
  /** Display combo of the global capture-bar hotkey; empty when unbound. */
  captureHint: string;
}

export function TaskPane({
  list,
  roots,
  ctx,
  sel,
  isSplit,
  searching,
  onCloseSplit,
  onCreateTask,
  onRootDrop,
  onRootDropSet,
  registerComposer,
  onFocusPane,
  captureHint,
}: Props) {
  const composerRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [rootDropOver, setRootDropOver] = useState(false);

  const visibleRoots = roots.filter(ctx.isVisible);

  // Rows augmented with this pane's selection, injected by spreading the shared
  // ctx — the two panes stay independent while sharing everything else.
  const paneCtx = useMemo<RowCtx>(
    () => ({
      ...ctx,
      selectedIds: sel.ids,
      onRowClick: sel.onRowClick,
      onToggleSelect: sel.onToggleSelect,
      selectionRoots: sel.selectionRoots,
      onBulkSetDone: sel.bulkSetDone,
      onBulkMove: sel.bulkMove,
      onBulkDelete: sel.bulkDelete,
    }),
    [ctx, sel]
  );

  // Whole-tree tally (roots + every nested subtask) for the stats bar.
  let total = 0;
  let done = 0;
  const tally = (t: Task) => {
    total += 1;
    if (t.done) done += 1;
    for (const c of ctx.childrenByParent[t.id] ?? []) tally(c);
  };
  roots.forEach(tally);
  const pct = total ? Math.round((done / total) * 100) : 0;

  useEffect(() => {
    registerComposer(list.id, (seed) => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      if (seed) el.value += seed;
    });
    return () => registerComposer(list.id, null);
  }, [list.id, registerComposer]);

  const submit = () => {
    const el = composerRef.current;
    const title = el?.value.trim();
    if (!el || !title) return;
    onCreateTask(list.id, title);
    el.value = '';
  };

  return (
    <section
      className="bg-surface-2l dark:bg-surface-2d flex h-full min-w-0 flex-1 flex-col"
      onMouseDown={() => onFocusPane(list.id)}
    >
      <div className="rounded-control bg-surface-0l dark:bg-surface-0d focus-within:ring-focus-1l dark:focus-within:ring-focus-1d mx-4 mt-3 mb-2 flex h-10 shrink-0 items-center gap-2.5 px-3 transition-shadow focus-within:ring-1">
        <Icon
          name="add"
          size={18}
          weight={300}
          className="text-content-3l dark:text-content-3d shrink-0"
        />
        <input
          ref={composerRef}
          placeholder="Add a task — Enter to save"
          onFocus={() => onFocusPane(list.id)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
          className="text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d w-full bg-transparent text-[14px] outline-none"
        />
        {isSplit && onCloseSplit && (
          <button
            onClick={onCloseSplit}
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d -mr-1 grid h-6 w-6 shrink-0 place-items-center"
            title="Close split"
          >
            <Icon name="close" size={16} weight={300} />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-task')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setRootDropOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (
            !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)
          )
            setRootDropOver(false);
        }}
        onDrop={(e) => {
          setRootDropOver(false);
          const setJson = e.dataTransfer.getData(TASK_SET_MIME);
          if (setJson) {
            e.preventDefault();
            onRootDropSet(JSON.parse(setJson) as string[], list.id);
            return;
          }
          const draggedId = e.dataTransfer.getData('application/x-task');
          if (draggedId) {
            e.preventDefault();
            onRootDrop(draggedId, list.id);
          }
        }}
      >
        <div ref={contentRef} className="relative pb-6">
          {visibleRoots.map((task) => (
            <TaskRow key={task.id} task={task} depth={0} ctx={paneCtx} />
          ))}
          {rootDropOver && ctx.draggingId && (
            <div className="rounded-field bg-accent-500l dark:bg-accent-500d relative mx-3 mt-1 h-0.5">
              <span className="bg-accent-500l dark:bg-accent-500d absolute top-1/2 -left-0.75 h-1.5 w-1.5 -translate-y-1/2 rounded-full" />
            </div>
          )}
          {visibleRoots.length === 0 && (
            <div className="flex flex-col items-center gap-2 pt-24 pb-10">
              <Icon
                name={searching ? 'search_off' : 'landscape'}
                size={30}
                weight={200}
                className="text-content-3l dark:text-content-3d mb-1"
              />
              <p className="font-display text-content-2l dark:text-content-2d text-[16px] font-medium">
                {searching ? `No matches in ${list.name}` : 'Nothing here yet'}
              </p>
              <p className="text-content-3l dark:text-content-3d px-4 text-center text-[13px] tracking-[0.01em]">
                {searching
                  ? 'Try a different search'
                  : captureHint
                    ? `Add a task above, or press ${captureHint} anywhere to capture one`
                    : 'Add a task above'}
              </p>
            </div>
          )}
        </div>
      </div>

      {sel.ids.size > 0 ? (
        <BulkBar sel={sel} count={sel.ids.size} otherLists={ctx.otherLists} />
      ) : (
        <StatsBar done={done} total={total} pct={pct} />
      )}
    </section>
  );
}

/** The action bar the footer shows while a selection is live: a count, the bulk
 *  verbs, and Clear. Replaces the old modal Select/Mark toggle entirely. */
function BulkBar({
  sel,
  count,
  otherLists,
}: {
  sel: PaneSelection;
  count: number;
  otherLists: List[];
}) {
  const menu = useContextMenu();
  const openMoveMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({
      x: r.left,
      y: r.bottom + 4,
      items: otherLists.map((l) => ({ id: l.id, label: l.name })),
      onPick: (id) => sel.bulkMove(id),
    });
  };
  const btn =
    'rounded-field text-content-2l dark:text-content-2d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d flex h-6 items-center gap-1 px-1.5 text-[12px] font-semibold normal-case tracking-normal transition-colors disabled:pointer-events-none disabled:opacity-40';
  return (
    <div className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d flex h-9 shrink-0 items-center gap-1 border-t px-3">
      <span className="text-content-1l dark:text-content-1d mr-1 pl-1 text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums">
        {count} selected
      </span>
      <span className="bg-edge-2l dark:bg-edge-2d h-3 w-px" />
      <button className={btn} onClick={() => sel.bulkSetDone(true)} title="Mark done">
        <Icon name="task_alt" size={15} weight={300} />
        Done
      </button>
      <button
        className={btn}
        onClick={() => sel.bulkSetDone(false)}
        title="Mark not done"
      >
        <Icon name="radio_button_unchecked" size={15} weight={300} />
        Undone
      </button>
      <button
        className={btn}
        onClick={openMoveMenu}
        disabled={otherLists.length === 0}
        title="Move to another list"
      >
        <Icon name="arrow_forward" size={15} weight={300} />
        Move to…
      </button>
      <button className={btn} onClick={sel.bulkCopy} title="Copy as checklist">
        <Icon name="content_copy" size={15} weight={300} />
        Copy
      </button>
      <button
        className={`${btn} hover:text-danger-500l dark:hover:text-danger-500d`}
        onClick={sel.bulkDelete}
        title="Delete selection"
      >
        <Icon name="delete" size={15} weight={300} />
        Delete
      </button>
      <button className={`${btn} ml-auto`} onClick={sel.clear} title="Clear selection">
        <Icon name="close" size={15} weight={300} />
        Clear
      </button>
    </div>
  );
}

function StatsBar({
  done,
  total,
  pct,
}: {
  done: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d text-content-3l dark:text-content-3d flex h-9 shrink-0 items-center gap-3 border-t px-4 text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums">
      <span>
        {done}/{total} done
      </span>
      <div className="ml-auto flex items-center gap-2">
        <span className="bg-surface-0l dark:bg-surface-0d relative h-1 w-24 overflow-hidden rounded-full">
          <span
            className="bg-accent-500l dark:bg-accent-500d absolute inset-y-0 left-0 rounded-full transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="text-content-2l dark:text-content-2d w-8 text-right">
          {pct}%
        </span>
      </div>
    </div>
  );
}
