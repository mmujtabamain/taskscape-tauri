import { cn } from '@taskscape/common-ui/cn';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { Icon } from '@taskscape/common-ui/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type List, type Task } from '../api';
import { registerSearchFocus } from '../lib/searchFocus';
import { scrollTaskIntoView } from '../lib/scroll';
import {
  dropOnRoot as actDropOnRoot,
  dropSetOnRoot as actDropSetOnRoot,
} from '../stores/actions';
import { readDroppedIds } from '../stores/dragStore';
import { useHotkeyStore } from '../stores/hotkeyStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';
import { directMatches, useSearchStore } from '../stores/searchStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';
import { isViewActive, useViewStore, type PaneView } from '../stores/viewStore';
import {
  flattenVisible,
  isVisibleInPane,
  orderForPane,
} from '../stores/visibility';
import {
  bulkCopy,
  bulkDelete,
  bulkMove,
  bulkSetDone,
  startNewTask,
} from '../commands/tasks';
import { useContextMenu } from './contextMenuContext';
import { PaneContext, usePaneId } from './paneContext';
import { TaskRow } from './TaskRow';

const EMPTY_ROOTS: Task[] = [];

/** One pane: its search bar, the task tree it scopes, and a footer that flips
 *  between per-pane stats and a bulk-action bar. The pane subscribes to just the
 *  stores that shape its visible tree and provides its list id via context so
 *  rows and controls read the rest of what they need directly. */
export function TaskPane({ list, isSplit }: { list: List; isSplit: boolean }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rootDropOver, setRootDropOver] = useState(false);

  const roots = useTaskStore((s) => s.rootsByList[list.id] ?? EMPTY_ROOTS);
  const childrenByParent = useTaskStore((s) => s.childrenByParent);
  // Subscribe (value unused) so the pane re-sorts/filters — via the live-reading
  // visibility helpers — whenever anything shaping its tree changes.
  useLayoutStore((s) => s.collapsed);
  useSettingsStore((s) => s.showCompleted);
  useViewStore((s) => s.byPane[list.id]);
  const paneSearch = useSearchStore((s) => s.byPane[list.id]);
  const activeProjectId = useProjectStore((s) => s.activeId);
  const draggingId = useUiStore((s) => s.draggingId);
  const selCount = useSelectionStore((s) => s.byPane[list.id]?.ids.size ?? 0);
  const captureHint = formatAccel(
    useHotkeyStore((s) => s.map['toggle_capture_bar'] ?? '')
  );

  const query = paneSearch?.query ?? '';
  const searching = query.trim().length > 0;

  const visibleRoots = orderForPane(
    list.id,
    roots.filter((t) => isVisibleInPane(t, list.id))
  );

  // Whole-tree tally (roots + every nested subtask) for the stats bar. Memoized
  // on the task maps' identity so it only recomputes when tasks actually change.
  const { done, total } = useMemo(() => {
    let total = 0;
    let done = 0;
    const tally = (t: Task) => {
      total += 1;
      if (t.done) done += 1;
      for (const c of childrenByParent[t.id] ?? []) tally(c);
    };
    roots.forEach(tally);
    return { done, total };
  }, [roots, childrenByParent]);
  const pct = total ? Math.round((done / total) * 100) : 0;

  useEffect(() => {
    registerSearchFocus(list.id, (seed) => {
      // ⌘F focuses the search field; a typed letter also seeds the query.
      const el = searchRef.current;
      if (!el) return;
      el.focus();
      if (seed) {
        const cur = useSearchStore.getState().get(list.id).query;
        useSearchStore.getState().setQuery(list.id, cur + seed);
      }
    });
    return () => registerSearchFocus(list.id, null);
  }, [list.id]);

  // Direct match count for the badge (memo-cheap; recomputed per keystroke).
  const matchCount = searching
    ? directMatches(query, paneSearch!.scope, paneSearch!.fields, list.id, activeProjectId).size
    : 0;

  // Enter / ⇧Enter cycle the matches in visual order, scrolling + previewing each.
  const cycleMatch = (dir: 1 | -1) => {
    const ps = useSearchStore.getState().get(list.id);
    const direct = directMatches(ps.query, ps.scope, ps.fields, list.id, activeProjectId);
    if (direct.size === 0) return;
    const ordered = flattenVisible(list.id)
      .map((t) => t.id)
      .filter((id) => direct.has(id));
    if (ordered.length === 0) return;
    const cur = useSelectionStore.getState().selectedTaskId;
    const at = ordered.indexOf(cur ?? '');
    const nextId = ordered[(at + dir + ordered.length) % ordered.length];
    useSelectionStore.getState().focus(nextId);
    scrollTaskIntoView(nextId);
  };

  const focusPane = () => useLayoutStore.getState().setPaneFocus(list.id);

  return (
    <PaneContext.Provider value={list.id}>
      <section
        className="bg-surface-2l dark:bg-surface-2d flex h-full min-w-0 flex-1 flex-col"
        onMouseDown={focusPane}
      >
        <div className="rounded-control bg-surface-0l dark:bg-surface-0d focus-within:ring-focus-1l dark:focus-within:ring-focus-1d mx-4 mt-3 mb-2 flex h-10 shrink-0 items-center gap-2.5 px-3 transition-shadow focus-within:ring-1">
          <Icon
            name="search"
            size={18}
            weight={300}
            className="text-content-3l dark:text-content-3d shrink-0"
          />
          <input
            ref={searchRef}
            value={query}
            placeholder={`Search ${list.name}`}
            onFocus={focusPane}
            onChange={(e) => useSearchStore.getState().setQuery(list.id, e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                useSearchStore.getState().clear(list.id);
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Enter') cycleMatch(e.shiftKey ? -1 : 1);
            }}
            className="text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d w-full bg-transparent text-[14px] outline-none"
          />
          <ScopeFields />
          {query.trim() && (
            <>
              <span className="text-content-3l dark:text-content-3d shrink-0 text-[11px] font-semibold tabular-nums">
                {matchCount}
              </span>
              <button
                onClick={() => useSearchStore.getState().clear(list.id)}
                title="Clear search"
                className="rounded-field text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center"
              >
                <Icon name="close" size={15} weight={300} />
              </button>
            </>
          )}
          <span className="bg-edge-2l dark:bg-edge-2d h-4 w-px shrink-0" />
          <button
            onClick={() => startNewTask(list.id)}
            title="New task"
            className="rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center transition-colors"
          >
            <Icon name="add" size={18} weight={400} />
          </button>
          {isSplit && (
            <button
              onClick={() => useLayoutStore.getState().closeSplit()}
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
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
              setRootDropOver(false);
          }}
          onDrop={(e) => {
            setRootDropOver(false);
            const ids = readDroppedIds(e);
            if (ids.length === 0) return;
            e.preventDefault();
            if (ids.length > 1) void actDropSetOnRoot(ids, list.id);
            else void actDropOnRoot(ids[0], list.id);
          }}
        >
          <div className="relative pb-6">
            {visibleRoots.map((task) => (
              <TaskRow key={task.id} taskId={task.id} depth={0} />
            ))}
            {rootDropOver && draggingId && (
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
                    ? 'Try a different search or scope'
                    : captureHint
                      ? `Press + or ⌘N to add a task, or ${captureHint} anywhere to capture one`
                      : 'Press + or ⌘N to add a task'}
                </p>
              </div>
            )}
          </div>
        </div>

        {selCount > 0 ? (
          <BulkBar count={selCount} />
        ) : (
          <StatsBar listName={list.name} done={done} total={total} pct={pct} />
        )}
      </section>
    </PaneContext.Provider>
  );
}

/** The scope (list / project / all) + fields (title / notes / both) control that
 *  sits inside the search field. A check marks the current choice. */
function ScopeFields() {
  const listId = usePaneId();
  const menu = useContextMenu();
  const state = useSearchStore((s) => s.byPane[listId]);
  const scope = state?.scope ?? 'list';
  const fields = state?.fields ?? 'both';
  const check = (on: boolean) => (on ? 'check' : undefined);
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const search = useSearchStore.getState();
    menu.open({
      x: r.left,
      y: r.bottom + 6,
      items: [
        { id: 'scope:list', label: 'This list', icon: check(scope === 'list') },
        { id: 'scope:project', label: 'Whole project', icon: check(scope === 'project') },
        { id: 'scope:all', label: 'All projects', icon: check(scope === 'all') },
        { id: 'fields:both', label: 'Title & notes', icon: check(fields === 'both'), dividerAbove: true },
        { id: 'fields:title', label: 'Title only', icon: check(fields === 'title') },
        { id: 'fields:notes', label: 'Notes only', icon: check(fields === 'notes') },
      ],
      onPick: (id) => {
        if (id.startsWith('scope:'))
          search.setScope(listId, id.slice(6) as 'list' | 'project' | 'all');
        if (id.startsWith('fields:'))
          search.setFields(listId, id.slice(7) as 'title' | 'notes' | 'both');
      },
    });
  };
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={open}
      title="Search options"
      className="rounded-field text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center"
    >
      <Icon name="tune" size={15} weight={300} />
    </button>
  );
}

/** The action bar the footer shows while a selection is live: a count, the bulk
 *  verbs, and Clear. All ops read the pane's live selection from the store. */
function BulkBar({ count }: { count: number }) {
  const listId = usePaneId();
  const menu = useContextMenu();
  const activeId = useProjectStore((s) => s.activeId);
  const otherLists = useListStore((s) => s.lists).filter(
    (l) => l.project_id === activeId
  );
  const openMoveMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({
      x: r.left,
      y: r.bottom + 4,
      items: otherLists.map((l) => ({ id: l.id, label: l.name })),
      onPick: (id) => void bulkMove(listId, id),
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
      <button className={btn} onClick={() => bulkSetDone(listId, true)} title="Mark done">
        <Icon name="task_alt" size={15} weight={300} />
        Done
      </button>
      <button className={btn} onClick={() => bulkSetDone(listId, false)} title="Mark not done">
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
      <button className={btn} onClick={() => bulkCopy(listId)} title="Copy as checklist">
        <Icon name="content_copy" size={15} weight={300} />
        Copy
      </button>
      <button
        className={cn(btn, 'hover:text-danger-500l dark:hover:text-danger-500d')}
        onClick={() => void bulkDelete(listId)}
        title="Delete selection"
      >
        <Icon name="delete" size={15} weight={300} />
        Delete
      </button>
      <button
        className={cn(btn, 'ml-auto')}
        onClick={() => useSelectionStore.getState().clear(listId)}
        title="Clear selection"
      >
        <Icon name="close" size={15} weight={300} />
        Clear
      </button>
    </div>
  );
}

/** The footer stats + a per-pane sort/filter control (D.1). */
function StatsBar({
  listName,
  done,
  total,
  pct,
}: {
  listName: string;
  done: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d text-content-3l dark:text-content-3d flex h-9 shrink-0 items-center gap-3 border-t px-4 text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums">
      <ViewControl listName={listName} />
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

/** Per-pane sort + filter. Opens the standalone `overlay` filter window for this
 *  pane; lights up while the pane's view differs from the defaults (D.1). */
function ViewControl({ listName }: { listName: string }) {
  const listId = usePaneId();
  const view = useViewStore((s) => s.byPane[listId]);
  const active = view ? isViewActive(view) : false;
  const open = () => {
    const current: PaneView = useViewStore.getState().get(listId);
    void api.openOverlay({ paneId: listId, paneName: listName, view: current });
  };
  return (
    <button
      onClick={open}
      title="Sort & filter"
      className={cn(
        'rounded-field flex h-5.5 items-center gap-1 px-1.5 text-[11px] font-semibold tracking-normal normal-case transition-colors',
        active
          ? 'text-accent-500l dark:text-accent-500d'
          : 'text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d'
      )}
    >
      <Icon name="tune" size={14} weight={300} />
      {active && <span className="text-[11px] tracking-normal normal-case">Filtered</span>}
    </button>
  );
}
