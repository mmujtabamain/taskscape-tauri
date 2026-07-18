import { cn } from '@taskscape/common-ui/cn';
import { emitTo, listen } from '@tauri-apps/api/event';
import { Icon } from '@taskscape/common-ui/Icon';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  GLYPHS,
  INNER,
  OUTER,
  useWindowFocused,
} from '../components/windowChrome';
import { isMac } from '../lib/platform';
import {
  DEFAULT_VIEW,
  isViewActive,
  type CreatedRange,
  type FilterMode,
  type PaneView,
  type SortDir,
  type SortMode,
} from '../stores/viewStore';

const WIDTH = 340;

interface OverlayProps {
  paneId: string;
  paneName: string;
  view: PaneView;
}

/** The overlay filter window: a standalone NSPanel (reused, only ever hidden)
 *  that edits one pane's sort + filters. Every change streams back to the main
 *  window as an `overlay-apply` event, so the list updates live. */
export function OverlayWindow() {
  const [props, setProps] = useState<OverlayProps | null>(null);

  useEffect(() => {
    let stale = false;
    const fetch = () =>
      void api
        .overlayCurrent()
        .then((cur) => {
          if (!stale) setProps(cur as OverlayProps);
        })
        .catch(() => {});
    fetch();
    const unRefresh = listen('overlay-refresh', fetch);
    // The panel is reused (hidden, not destroyed); clear its content on close so
    // the next open can't flash the previous pane's filters while it fades out.
    const unClear = listen('overlay-clear', () => {
      if (!stale) setProps(null);
    });
    return () => {
      stale = true;
      unRefresh.then((fn) => fn());
      unClear.then((fn) => fn());
    };
  }, []);

  if (!props)
    return <div className="bg-surface-2l dark:bg-surface-2d h-screen w-screen" />;
  return (
    <OverlayContent
      key={`${props.paneId}|${JSON.stringify(props.view)}`}
      {...props}
    />
  );
}

/** Title-bar close disc — only Close is live; it hides the reused panel. */
function OverlayClose({ onClose }: { onClose: () => void }) {
  const focused = useWindowFocused();
  if (!isMac)
    return (
      <button
        onClick={onClose}
        title="Close"
        data-no-drag
        className="text-content-2l dark:text-content-2d flex h-full w-11 items-center justify-center transition-colors duration-100 hover:bg-[#e81123] hover:text-white"
      >
        <Icon name="close" size={18} />
      </button>
    );
  return (
    <div className="group flex items-center gap-2 pr-3 pl-5" data-no-drag>
      <button onClick={onClose} title="Close" className="block size-3.25">
        <svg viewBox="0 0 85.4 85.4" className="size-full" fillRule="evenodd">
          <path d={OUTER} fill={focused ? '#e24b41' : 'var(--tl-inactive-ring)'} />
          <path d={INNER} fill={focused ? '#ed6a5f' : 'var(--tl-inactive-fill)'} />
          {focused && (
            <g
              fill="#460804"
              className="opacity-0 transition-opacity duration-100 group-hover:opacity-100"
            >
              {GLYPHS.close}
            </g>
          )}
        </svg>
      </button>
    </div>
  );
}

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

function OverlayContent({ paneId, paneName, view: initial }: OverlayProps) {
  const [view, setView] = useState<PaneView>(initial);
  const [presented, setPresented] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const presentedRef = useRef(false);

  const push = (next: PaneView) => {
    setView(next);
    void emitTo('main', 'overlay-apply', { paneId, view: next });
  };
  const update = (partial: Partial<PaneView>) => push({ ...view, ...partial });
  const reset = () => push({ ...DEFAULT_VIEW });
  const close = () => void api.closeOverlay();

  useEffect(() => {
    if (presentedRef.current) return;
    presentedRef.current = true;
    void document.fonts.ready.then(() => {
      const height = (contentRef.current?.scrollHeight ?? 400) + 2;
      void api.presentWindow(WIDTH, height);
      setPresented(true);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const active = isViewActive(view);

  return (
    <div
      data-tauri-drag-region
      className="border-edge-2l dark:border-edge-2d bg-surface-2l dark:bg-surface-2d relative h-screen w-screen overflow-hidden border"
    >
      <div ref={contentRef} className="w-full" style={presented ? undefined : { opacity: 0 }}>
        <div
          data-tauri-drag-region
          className="relative flex h-11 shrink-0 items-stretch"
        >
          {isMac && <OverlayClose onClose={close} />}
          <div
            data-tauri-drag-region
            className={cn('flex min-w-0 flex-1 items-center gap-2', isMac ? 'pr-4' : 'pr-2 pl-4')}
          >
            <Icon
              name="tune"
              size={16}
              className="text-content-2l dark:text-content-2d shrink-0"
            />
            <h1
              data-tauri-drag-region
              className="font-display text-content-1l dark:text-content-1d truncate text-[13.5px] leading-none font-semibold"
            >
              Filter &amp; Sort
              <span className="text-content-3l dark:text-content-3d font-medium">
                {' · '}
                {paneName}
              </span>
            </h1>
          </div>
          {!isMac && <OverlayClose onClose={close} />}
        </div>

        <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
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

        <div className="border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d flex items-center gap-2 border-t px-3 py-2.5">
          <button
            onClick={reset}
            disabled={!active}
            className="rounded-control text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d flex h-8 items-center gap-1 px-2.5 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="restart_alt" size={15} />
            Reset
          </button>
          <button
            onClick={close}
            className="rounded-control bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift hover:bg-accent-600l dark:hover:bg-accent-600d ml-auto flex h-8 items-center px-4 text-[12.5px] font-semibold transition-colors"
          >
            Done
          </button>
        </div>
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
