import { useEffect, useRef, useState } from 'react';
import type { List, Task } from '../api';
import { Icon } from '@taskscape/common-ui/Icon';
import { TaskRow, type RowCtx } from './TaskRow';

interface Props {
  list: List;
  roots: Task[];
  ctx: RowCtx;
  isSplit: boolean;
  searching: boolean;
  onCloseSplit?: () => void;
  onCreateTask: (listId: string, title: string) => void;
  onRootDrop: (draggedId: string, listId: string) => void;
  registerComposer: (
    listId: string,
    focus: ((seed?: string) => void) | null
  ) => void;
  onFocusPane: (listId: string) => void;
}

export function TaskPane({
  list,
  roots,
  ctx,
  isSplit,
  searching,
  onCloseSplit,
  onCreateTask,
  onRootDrop,
  registerComposer,
  onFocusPane,
}: Props) {
  const composerRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [rootDropOver, setRootDropOver] = useState(false);

  const visibleRoots = roots.filter(ctx.isVisible);
  const open = roots.filter((t) => !t.done).length;

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
          const draggedId = e.dataTransfer.getData('application/x-task');
          if (draggedId) {
            e.preventDefault();
            onRootDrop(draggedId, list.id);
          }
        }}
      >
        <div ref={contentRef} className="relative pb-6">
          {visibleRoots.map((task) => (
            <TaskRow key={task.id} task={task} depth={0} ctx={ctx} />
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
                  : 'Add a task above, or press ⌘⏎ anywhere to capture one'}
              </p>
            </div>
          )}
        </div>
      </div>

      <StatsBar open={open} done={done} total={total} pct={pct} />
    </section>
  );
}

function StatsBar({
  open,
  done,
  total,
  pct,
}: {
  open: number;
  done: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d text-content-3l dark:text-content-3d flex h-9 shrink-0 items-center gap-3 border-t px-4 text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums">
      <span className="text-accent-500l dark:text-accent-500d">
        {open} open
      </span>
      <span className="bg-edge-2l dark:bg-edge-2d h-3 w-px" />
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
