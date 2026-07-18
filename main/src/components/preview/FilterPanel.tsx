import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import { useListStore } from '../../stores/listStore';
import {
  DEFAULT_VIEW,
  isViewActive,
  useViewStore,
  type CreatedRange,
  type FilterMode,
  type PaneView,
  type SortDir,
  type SortMode,
} from '../../stores/viewStore';

const SORTS: { id: SortMode; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'created', label: 'Date created' },
  { id: 'alpha', label: 'Alphabetical' },
  { id: 'done-last', label: 'Done last' },
];
const FILTERS: { id: FilterMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
];
const CREATED: { id: CreatedRange; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

/** Per-pane sort + filter controls, hosted in the preview panel (like the Trash
 *  view). Every change writes straight to the view store, so the pane's list
 *  re-renders live — no window, no event round-trip. */
export function FilterPanel({
  paneId,
  onClose,
}: {
  paneId: string;
  onClose: () => void;
}) {
  const view = useViewStore((s) => s.byPane[paneId] ?? DEFAULT_VIEW);
  const name = useListStore((s) => s.lists.find((l) => l.id === paneId)?.name);

  const update = (partial: Partial<PaneView>) =>
    useViewStore.getState().patch(paneId, partial);
  const reset = () => useViewStore.getState().reset(paneId);

  const active = isViewActive(view);

  return (
    <div className="bg-surface-1l dark:bg-surface-1d flex h-full w-full flex-col">
      <div className="border-edge-1l dark:border-edge-1d flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Icon
          name="tune"
          size={18}
          weight={300}
          className="text-content-2l dark:text-content-2d shrink-0"
        />
        <span className="font-display text-content-1l dark:text-content-1d flex min-w-0 flex-1 items-baseline gap-1 text-[14px] font-semibold">
          <span className="shrink-0">Filter &amp; Sort</span>
          {name && (
            <span className="text-content-3l dark:text-content-3d truncate text-[12px] font-medium">
              · {name}
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-7 w-7 shrink-0 place-items-center"
          title="Close"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <Section label="Sort by">
          <Segmented
            options={SORTS}
            value={view.sort}
            onChange={(sort) => update({ sort })}
          />
          <div className="mt-2 flex items-center gap-1.5">
            <DirButton
              dir="asc"
              current={view.dir}
              icon="arrow_upward"
              label="Ascending"
              disabled={view.sort === 'manual'}
              onPick={(dir) => update({ dir })}
            />
            <DirButton
              dir="desc"
              current={view.dir}
              icon="arrow_downward"
              label="Descending"
              disabled={view.sort === 'manual'}
              onPick={(dir) => update({ dir })}
            />
          </div>
        </Section>

        <Section label="Show">
          <Segmented
            options={FILTERS}
            value={view.filter}
            onChange={(filter) => update({ filter })}
          />
        </Section>

        <Section label="Refine">
          <div className="flex flex-col gap-1">
            <Toggle
              label="Has notes"
              icon="notes"
              on={view.hasNotes}
              onToggle={() => update({ hasNotes: !view.hasNotes })}
            />
            <Toggle
              label="Has attachments"
              icon="attach_file"
              on={view.hasAttachments}
              onToggle={() => update({ hasAttachments: !view.hasAttachments })}
            />
            <Toggle
              label="Has subtasks"
              icon="account_tree"
              on={view.hasSubtasks}
              onToggle={() => update({ hasSubtasks: !view.hasSubtasks })}
            />
          </div>
        </Section>

        <Section label="Created">
          <Segmented
            options={CREATED}
            value={view.created}
            onChange={(created) => update({ created })}
          />
        </Section>
      </div>

      <div className="border-edge-1l dark:border-edge-1d bg-surface-1l dark:bg-surface-1d flex items-center gap-2 border-t px-3 py-2.5">
        <button
          onClick={reset}
          disabled={!active}
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-content-3l dark:text-content-3d mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              'rounded-field h-7 px-2 text-[12.5px] font-medium transition-colors',
              on
                ? 'bg-accent-500l dark:bg-accent-500d text-on-accent'
                : 'bg-surface-0l dark:bg-surface-0d text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function DirButton({
  dir,
  current,
  icon,
  label,
  disabled,
  onPick,
}: {
  dir: SortDir;
  current: SortDir;
  icon: string;
  label: string;
  disabled: boolean;
  onPick: (dir: SortDir) => void;
}) {
  const on = current === dir;
  return (
    <button
      onClick={() => onPick(dir)}
      disabled={disabled}
      title={label}
      className={cn(
        'rounded-field flex h-7 flex-1 items-center justify-center gap-1 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        on
          ? 'bg-accent-500l dark:bg-accent-500d text-on-accent'
          : 'bg-surface-0l dark:bg-surface-0d text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d'
      )}
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}

function Toggle({
  label,
  icon,
  on,
  onToggle,
}: {
  label: string;
  icon: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="rounded-field hover:bg-wash-1l dark:hover:bg-wash-1d flex h-8 items-center gap-2.5 px-2 transition-colors"
    >
      <span
        className={cn(
          'grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors',
          on
            ? 'bg-accent-500l dark:bg-accent-500d border-transparent'
            : 'border-edge-3l dark:border-edge-3d'
        )}
      >
        {on && <Icon name="check" size={12} weight={700} className="text-on-accent" />}
      </span>
      <Icon name={icon} size={15} className="text-content-3l dark:text-content-3d shrink-0" />
      <span className="text-content-1l dark:text-content-1d text-[13px] font-medium">
        {label}
      </span>
    </button>
  );
}
