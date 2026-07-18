import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import type { Task } from '../../api';
import { useLayoutStore } from '../../stores/layoutStore';
import { useListStore } from '../../stores/listStore';
import { useSearchStore } from '../../stores/searchStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import {
  DEFAULT_VIEW,
  isViewActive,
  useViewStore,
  type DateField,
  type DateRange,
  type FilterMode,
  type PaneView,
  type SortDir,
  type SortMode,
  type TriState,
} from '../../stores/viewStore';
import { isVisibleInPane } from '../../stores/visibility';
import { useContextMenu, type MenuItem } from '../contextMenuContext';

const SORTS: { id: SortMode; label: string; icon: string }[] = [
  { id: 'manual', label: 'Manual', icon: 'drag_indicator' },
  { id: 'created', label: 'Date created', icon: 'calendar_add_on' },
  { id: 'updated', label: 'Date updated', icon: 'edit_calendar' },
  { id: 'alpha', label: 'Alphabetical', icon: 'sort_by_alpha' },
  { id: 'done-last', label: 'Done last', icon: 'low_priority' },
];
const SHOW: { id: FilterMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Done' },
];
const FIELDS: { id: DateField; label: string }[] = [
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Updated' },
];
const RANGES: { id: DateRange; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'day', label: 'Last 24 hours' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom…' },
];
const TRI: { id: TriState; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'has', label: 'With' },
  { id: 'none', label: 'Without' },
];

/** Sort + filter controls, hosted in the preview panel. Targets whatever the
 *  window currently shows — the focused pane's view is displayed, and while
 *  split every change writes the same view to BOTH panes. Every change hits the
 *  view store directly, so the lists re-render live. */
export function FilterPanel({ onClose }: { onClose: () => void }) {
  const activeListId = useLayoutStore((s) => s.activeListId);
  const splitListId = useLayoutStore((s) => s.splitListId);
  const paneFocus = useLayoutStore((s) => s.paneFocus);
  const lists = useListStore((s) => s.lists);
  const byPane = useViewStore((s) => s.byPane);
  // Re-render the match counts when anything shaping visibility changes.
  useTaskStore((s) => s.tasks);
  useSearchStore((s) => s.byPane);
  useSettingsStore((s) => s.showCompleted);

  const targets = [activeListId, splitListId].filter(
    (id): id is string => id != null
  );
  const focusId =
    paneFocus != null && targets.includes(paneFocus) ? paneFocus : activeListId;
  const view = (focusId ? byPane[focusId] : undefined) ?? DEFAULT_VIEW;
  const split = targets.length > 1;

  const name = (id: string) => lists.find((l) => l.id === id)?.name ?? '…';

  // While split the panes act as one: each edit writes the full displayed view
  // to every visible pane, unifying them from the first change on.
  const update = (partial: Partial<PaneView>) => {
    const next = { ...view, ...partial };
    const vs = useViewStore.getState();
    for (const id of targets) vs.set(id, next);
  };
  const resetAll = () => {
    const vs = useViewStore.getState();
    for (const id of targets) vs.reset(id);
  };

  const anyActive = targets.some((id) =>
    isViewActive(byPane[id] ?? DEFAULT_VIEW)
  );

  const stats = targets.map((id) => {
    const { rootsByList, childrenByParent } = useTaskStore.getState();
    let shown = 0;
    let total = 0;
    const walk = (t: Task) => {
      total += 1;
      if (isVisibleInPane(t, id)) shown += 1;
      for (const c of childrenByParent[t.id] ?? []) walk(c);
    };
    for (const r of rootsByList[id] ?? []) walk(r);
    return { name: name(id), shown, total };
  });

  const sortActive = view.sort !== 'manual' || view.dir !== 'asc';
  const refineActive =
    view.notes !== 'any' || view.attachments !== 'any' || view.subtasks !== 'any';
  const dateActive = view.dateRange !== 'any';
  const sortMeta = SORTS.find((s) => s.id === view.sort) ?? SORTS[0];

  return (
    <div className="bg-surface-1l dark:bg-surface-1d flex h-full w-full flex-col">
      <div className="border-edge-1l dark:border-edge-1d flex h-12 shrink-0 items-center gap-2.5 border-b px-3">
        <Icon
          name="tune"
          size={18}
          weight={300}
          className="text-content-2l dark:text-content-2d shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="font-display text-content-1l dark:text-content-1d truncate text-[14px] leading-tight font-semibold">
            Filter &amp; Sort
          </span>
          <span className="text-content-3l dark:text-content-3d truncate text-[11px] leading-tight font-medium">
            {targets.length === 0
              ? 'No list open'
              : targets.map(name).join(', ')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-7 w-7 shrink-0 place-items-center"
          title="Close"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <Section
          label="Sort"
          active={sortActive}
          onClear={() => update({ sort: 'manual', dir: 'asc' })}
        >
          <div className="flex items-center gap-1.5">
            <MenuButton
              className="min-w-0 flex-1"
              icon={sortMeta.icon}
              label={sortMeta.label}
              items={SORTS.map((s) => ({
                id: s.id,
                label: s.label,
                icon: s.id === view.sort ? 'check' : undefined,
              }))}
              onPick={(id) => update({ sort: id as SortMode })}
            />
            <div className="bg-surface-0l dark:bg-surface-0d rounded-field flex shrink-0 gap-0.5 p-0.5">
              {(['asc', 'desc'] as SortDir[]).map((dir) => (
                <button
                  key={dir}
                  onClick={() => update({ dir })}
                  disabled={view.sort === 'manual'}
                  title={dir === 'asc' ? 'Ascending' : 'Descending'}
                  className={cn(
                    'grid h-6.5 w-7 place-items-center rounded-[5px] transition-colors disabled:pointer-events-none disabled:opacity-40',
                    view.dir === dir && view.sort !== 'manual'
                      ? 'bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift'
                      : 'text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d'
                  )}
                >
                  <Icon
                    name={dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                    size={14}
                  />
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section
          label="Show"
          active={view.filter !== 'all'}
          onClear={() => update({ filter: 'all' })}
        >
          <Segmented
            options={SHOW}
            value={view.filter}
            onChange={(filter) => update({ filter })}
          />
        </Section>

        <Section
          label="Refine"
          active={refineActive}
          onClear={() =>
            update({ notes: 'any', attachments: 'any', subtasks: 'any' })
          }
        >
          <div className="flex flex-col gap-1">
            <TriRow
              icon="notes"
              label="Notes"
              value={view.notes}
              onChange={(notes) => update({ notes })}
            />
            <TriRow
              icon="attach_file"
              label="Attachments"
              value={view.attachments}
              onChange={(attachments) => update({ attachments })}
            />
            <TriRow
              icon="account_tree"
              label="Subtasks"
              value={view.subtasks}
              onChange={(subtasks) => update({ subtasks })}
            />
          </div>
        </Section>

        <Section
          label="Date"
          active={dateActive}
          onClear={() =>
            update({
              dateField: DEFAULT_VIEW.dateField,
              dateRange: 'any',
              customDays: DEFAULT_VIEW.customDays,
            })
          }
        >
          <div className="flex flex-col gap-1.5">
            <Segmented
              options={FIELDS}
              value={view.dateField}
              onChange={(dateField) => update({ dateField })}
            />
            <MenuButton
              icon="schedule"
              label={RANGES.find((r) => r.id === view.dateRange)!.label}
              items={RANGES.map((r) => ({
                id: r.id,
                label: r.label,
                icon: r.id === view.dateRange ? 'check' : undefined,
              }))}
              onPick={(id) => update({ dateRange: id as DateRange })}
            />
            {view.dateRange === 'custom' && (
              <DaysStepper
                value={view.customDays}
                onChange={(customDays) => update({ customDays })}
              />
            )}
          </div>
        </Section>
      </div>

      <div className="border-edge-1l dark:border-edge-1d flex h-9 shrink-0 items-center gap-2 border-t px-4">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            anyActive
              ? 'bg-accent-500l dark:bg-accent-500d'
              : 'bg-edge-3l dark:bg-edge-3d'
          )}
        />
        <span className="text-content-2l dark:text-content-2d truncate text-[11.5px] font-medium tabular-nums">
          {stats.length === 0
            ? 'Nothing to filter'
            : split
              ? stats.map((s) => `${s.name} ${s.shown}/${s.total}`).join(' · ')
              : `Showing ${stats[0].shown} of ${stats[0].total} tasks`}
        </span>
      </div>

      <div className="border-edge-1l dark:border-edge-1d bg-surface-1l dark:bg-surface-1d flex items-center gap-2 border-t px-3 py-2.5">
        <button
          onClick={resetAll}
          disabled={!anyActive}
          className="rounded-control text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d flex h-8 items-center gap-1 px-2.5 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="restart_alt" size={15} />
          Reset
        </button>
        <button
          onClick={onClose}
          className="rounded-control bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift hover:bg-accent-600l dark:hover:bg-accent-600d ml-auto flex h-8 items-center px-4 text-[12.5px] font-semibold transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** Section header with an accent dot + clear button while it's non-default. */
function Section({
  label,
  active,
  onClear,
  children,
}: {
  label: string;
  active: boolean;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex h-5 items-center gap-2">
        <span className="text-content-3l dark:text-content-3d text-[10.5px] font-semibold tracking-[0.08em] uppercase">
          {label}
        </span>
        {active && (
          <span className="bg-accent-500l dark:bg-accent-500d h-1 w-1 shrink-0 rounded-full" />
        )}
        <span className="border-edge-1l dark:border-edge-1d flex-1 border-t" />
        {active && (
          <button
            onClick={onClear}
            title={`Clear ${label.toLowerCase()}`}
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-5 w-5 place-items-center"
          >
            <Icon name="restart_alt" size={13} weight={300} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Joined segmented control on a recessed track; the active segment is a
 *  raised accent thumb. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  size?: 'md' | 'sm';
}) {
  return (
    <div className="bg-surface-0l dark:bg-surface-0d rounded-field grid auto-cols-fr grid-flow-col gap-0.5 p-0.5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              'truncate rounded-[5px] font-medium transition-colors',
              size === 'md' ? 'h-6.5 px-2 text-[12px]' : 'h-5.5 px-1 text-[11px]',
              on
                ? 'bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift'
                : 'text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A dropdown field: current value + chevron, opening a native-style menu. */
function MenuButton({
  label,
  icon,
  items,
  onPick,
  className,
}: {
  label: string;
  icon?: string;
  items: MenuItem[];
  onPick: (id: string) => void;
  className?: string;
}) {
  const menu = useContextMenu();
  const open = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({ x: r.left, y: r.bottom + 4, items, onPick });
  };
  return (
    <button
      onClick={open}
      className={cn(
        'bg-surface-0l dark:bg-surface-0d rounded-field hover:bg-wash-1l dark:hover:bg-wash-1d flex h-7.5 items-center gap-2 px-2.5 transition-colors',
        className
      )}
    >
      {icon && (
        <Icon
          name={icon}
          size={15}
          weight={300}
          className="text-content-3l dark:text-content-3d shrink-0"
        />
      )}
      <span className="text-content-1l dark:text-content-1d min-w-0 flex-1 truncate text-left text-[12.5px] font-medium">
        {label}
      </span>
      <Icon
        name="unfold_more"
        size={14}
        className="text-content-3l dark:text-content-3d shrink-0"
      />
    </button>
  );
}

/** One refine predicate: label plus an Any / With / Without mini-segment. */
function TriRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: string;
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
}) {
  return (
    <div className="flex h-8 items-center gap-2.5">
      <Icon
        name={icon}
        size={15}
        weight={300}
        className="text-content-3l dark:text-content-3d shrink-0"
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] font-medium',
          value === 'any'
            ? 'text-content-2l dark:text-content-2d'
            : 'text-content-1l dark:text-content-1d'
        )}
      >
        {label}
      </span>
      <div className="w-40 shrink-0">
        <Segmented size="sm" options={TRI} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/** "Within the last N days" stepper for the custom date range. */
function DaysStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(365, Math.max(1, Math.round(n) || 1));
  const btn =
    'bg-surface-0l dark:bg-surface-0d rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-6.5 w-6.5 shrink-0 place-items-center transition-colors';
  return (
    <div className="flex items-center gap-1.5 pl-0.5">
      <span className="text-content-2l dark:text-content-2d min-w-0 flex-1 truncate text-[12.5px] font-medium">
        Within the last
      </span>
      <button className={btn} title="Fewer days" onClick={() => onChange(clamp(value - 1))}>
        <Icon name="remove" size={14} />
      </button>
      <input
        type="number"
        min={1}
        max={365}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="bg-surface-0l dark:bg-surface-0d rounded-field text-content-1l dark:text-content-1d focus:ring-focus-1l dark:focus:ring-focus-1d h-6.5 w-12 text-center text-[12.5px] font-medium tabular-nums outline-none focus:ring-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button className={btn} title="More days" onClick={() => onChange(clamp(value + 1))}>
        <Icon name="add" size={14} />
      </button>
      <span className="text-content-2l dark:text-content-2d text-[12.5px] font-medium">
        days
      </span>
    </div>
  );
}
