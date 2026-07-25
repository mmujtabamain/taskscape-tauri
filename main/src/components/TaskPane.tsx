import { cn } from '@taskscape/common-ui/cn';
import {
  Divider,
  EmptyState,
  IconButton,
  InputWell,
  Label,
  ProgressBar,
  TextInput,
  ToolbarButton,
} from '@taskscape/common-ui/components';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { Icon } from '@taskscape/common-ui/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type List, type Task } from '../api';
import {
  bulkCopy,
  bulkDelete,
  bulkMove,
  bulkSetDone,
  startNewTask,
} from '../commands/tasks';
import { scrollTaskIntoView } from '../lib/scroll';
import { registerSearchFocus } from '../lib/searchFocus';
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
import { isViewActive, useViewStore } from '../stores/viewStore';
import {
  flattenVisible,
  isVisibleInPane,
  orderForPane,
} from '../stores/visibility';
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

  // Auto-scroll the pane while a task drag hovers near its top/bottom edge, so a
  // drag can reach rows outside the current viewport. A rAF loop keeps scrolling
  // even when the pointer is held still in the edge zone (dragover stops firing).
  // The listener is capture-phase on window because rows stopPropagation their
  // own dragover, which would otherwise hide it from a bubble-phase handler.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const EDGE = 56;
    const MAX = 16;
    let raf = 0;
    let speed = 0;
    const tick = () => {
      el.scrollTop += speed;
      raf = speed !== 0 ? requestAnimationFrame(tick) : 0;
    };
    const onDragOver = (e: DragEvent) => {
      if (!useUiStore.getState().draggingId) return;
      const r = el.getBoundingClientRect();
      const inside =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      const topGap = e.clientY - r.top;
      const botGap = r.bottom - e.clientY;
      speed = !inside
        ? 0
        : topGap < EDGE
          ? -Math.ceil(((EDGE - topGap) / EDGE) * MAX)
          : botGap < EDGE
            ? Math.ceil(((EDGE - botGap) / EDGE) * MAX)
            : 0;
      if (speed !== 0 && raf === 0) raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      speed = 0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', stop, true);
    window.addEventListener('dragend', stop, true);
    return () => {
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', stop, true);
      window.removeEventListener('dragend', stop, true);
      stop();
    };
  }, []);

  // Direct match count for the badge (memo-cheap; recomputed per keystroke).
  const matchCount = searching
    ? directMatches(
        query,
        paneSearch!.scope,
        paneSearch!.fields,
        list.id,
        activeProjectId
      ).size
    : 0;

  // Enter / ⇧Enter cycle the matches in visual order, scrolling + previewing each.
  const cycleMatch = (dir: 1 | -1) => {
    const ps = useSearchStore.getState().get(list.id);
    const direct = directMatches(
      ps.query,
      ps.scope,
      ps.fields,
      list.id,
      activeProjectId
    );
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
        <InputWell
          className="mx-4 mt-3 mb-2 h-10 shrink-0"
          leading={<Icon name="search" size={18} weight={300} />}
        >
          <TextInput
            bare
            ref={searchRef}
            value={query}
            placeholder={`Search ${list.name}`}
            onFocus={focusPane}
            onChange={(e) =>
              useSearchStore.getState().setQuery(list.id, e.target.value)
            }
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                useSearchStore.getState().clear(list.id);
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Enter') cycleMatch(e.shiftKey ? -1 : 1);
            }}
            className="w-full text-[14px]"
          />
          <ScopeFields />
          {query.trim() && (
            <>
              <Label
                tone="muted"
                weight="semibold"
                className="shrink-0 text-[11px] tabular-nums"
              >
                {matchCount}
              </Label>
              <IconButton
                icon="close"
                iconSize={15}
                iconWeight={300}
                variant="plain"
                onClick={() => useSearchStore.getState().clear(list.id)}
                title="Clear search"
              />
            </>
          )}
          <Divider orientation="vertical" className="h-4 shrink-0" />
          <IconButton
            icon="add"
            iconSize={18}
            iconWeight={400}
            onClick={() => startNewTask(list.id)}
            title="New task"
          />
          {isSplit && (
            <IconButton
              icon="close"
              iconSize={16}
              iconWeight={300}
              className="-mr-1"
              onClick={() => useLayoutStore.getState().closeSplit()}
              title="Close split"
            />
          )}
        </InputWell>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onClick={(e) => {
            // A click on blank pane space (not a row) drops the selection + preview.
            if ((e.target as HTMLElement).closest('[data-task-id]')) return;
            useSelectionStore.getState().clear(list.id);
            useSelectionStore.getState().focus(null);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-task')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setRootDropOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (
              !(e.currentTarget as HTMLElement).contains(
                e.relatedTarget as Node
              )
            )
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
                <span className="bg-accent-500l dark:bg-accent-500d -left-space-2 absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" />
              </div>
            )}
            {visibleRoots.length === 0 && (
              <EmptyState
                icon={searching ? 'search_off' : 'landscape'}
                iconSize={30}
                title={
                  searching ? `No matches in ${list.name}` : 'Nothing here yet'
                }
                subtitle={
                  searching
                    ? 'Try a different search or scope'
                    : captureHint
                      ? `Press + or ⌘N to add a task, or ${captureHint} anywhere to capture one`
                      : 'Press + or ⌘N to add a task'
                }
                className="pt-24 pb-10"
              />
            )}
          </div>
        </div>

        {selCount > 0 ? (
          <BulkBar count={selCount} />
        ) : (
          <StatsBar done={done} total={total} pct={pct} />
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
        {
          id: 'scope:project',
          label: 'Whole project',
          icon: check(scope === 'project'),
        },
        {
          id: 'scope:all',
          label: 'All projects',
          icon: check(scope === 'all'),
        },
        {
          id: 'fields:both',
          label: 'Title & notes',
          icon: check(fields === 'both'),
          dividerAbove: true,
        },
        {
          id: 'fields:title',
          label: 'Title only',
          icon: check(fields === 'title'),
        },
        {
          id: 'fields:notes',
          label: 'Notes only',
          icon: check(fields === 'notes'),
        },
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
    <IconButton
      icon="tune"
      iconSize={15}
      iconWeight={300}
      variant="plain"
      onMouseDown={(e) => e.preventDefault()}
      onClick={open}
      title="Search options"
    />
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
  return (
    <div className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d gap-space-2 px-space-6 flex h-9 shrink-0 items-center border-t">
      <Label
        tone="primary"
        weight="semibold"
        className="mr-1 pl-1 text-[11px] tracking-[0.08em] uppercase tabular-nums"
      >
        {count} selected
      </Label>
      <Divider orientation="vertical" className="h-3" />
      <ToolbarButton
        icon="task_alt"
        iconWeight={300}
        size="sm"
        onClick={() => bulkSetDone(listId, true)}
        title="Mark done"
      >
        Done
      </ToolbarButton>
      <ToolbarButton
        icon="radio_button_unchecked"
        iconWeight={300}
        size="sm"
        onClick={() => bulkSetDone(listId, false)}
        title="Mark not done"
      >
        Undone
      </ToolbarButton>
      <ToolbarButton
        icon="arrow_forward"
        iconWeight={300}
        size="sm"
        onClick={openMoveMenu}
        disabled={otherLists.length === 0}
        title="Move to another list"
      >
        Move to…
      </ToolbarButton>
      <ToolbarButton
        icon="content_copy"
        iconWeight={300}
        size="sm"
        onClick={() => bulkCopy(listId)}
        title="Copy as checklist"
      >
        Copy
      </ToolbarButton>
      <ToolbarButton
        icon="delete"
        iconWeight={300}
        size="sm"
        variant="danger"
        onClick={() => void bulkDelete(listId)}
        title="Delete selection"
      >
        Delete
      </ToolbarButton>
      <ToolbarButton
        icon="close"
        iconWeight={300}
        size="sm"
        className="ml-auto"
        onClick={() => useSelectionStore.getState().clear(listId)}
        title="Clear selection"
      >
        Clear
      </ToolbarButton>
    </div>
  );
}

/** The footer stats + a per-pane sort/filter control (D.1). */
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
    <Label
      as="div"
      tone="muted"
      weight="semibold"
      className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d gap-space-5 px-space-7 flex h-9 shrink-0 items-center border-t text-[11px] tracking-[0.08em] uppercase tabular-nums"
    >
      <ViewControl />
      <Divider orientation="vertical" className="h-3" />
      <span>
        {done}/{total} done
      </span>
      <div className="gap-space-4 ml-auto flex items-center">
        <ProgressBar value={total ? done / total : 0} />
        <Label tone="secondary" className="w-8 text-right">
          {pct}%
        </Label>
      </div>
    </Label>
  );
}

/** Per-pane sort + filter. Toggles the Filter & Sort controls in the preview
 *  panel (they follow the visible pane(s)); lights up while the pane's view
 *  differs from the defaults (D.1). */
function ViewControl() {
  const listId = usePaneId();
  const view = useViewStore((s) => s.byPane[listId]);
  const active = view ? isViewActive(view) : false;
  const toggle = () => {
    const ui = useUiStore.getState();
    ui.setFilterOpen(!ui.filterOpen);
  };
  return (
    <button
      onClick={toggle}
      title="Sort & filter"
      className={cn(
        'rounded-field gap-space-2 px-space-4 flex h-5.5 items-center text-[11px] font-semibold tracking-normal normal-case',
        active
          ? 'text-accent-500l dark:text-accent-500d'
          : 'text-content-3l dark:text-content-3d hover:text-content-1l dark:hover:text-content-1d'
      )}
    >
      <Icon name="tune" size={14} weight={300} />
      {active && (
        <span className="text-[11px] tracking-normal normal-case">
          Filtered
        </span>
      )}
    </button>
  );
}
