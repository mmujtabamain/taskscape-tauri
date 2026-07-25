import { cn } from '@taskscape/common-ui/cn';
import {
  Badge,
  EmptyState,
  IconButton,
  InputWell,
  Label,
  MenuItem,
  SettingRow,
  SettingsGroup,
  TextInput,
} from '@taskscape/common-ui/components';
import { Icon } from '@taskscape/common-ui/Icon';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { api, type DataPaths } from '../api';
import { useLowPowerMode } from '../lib/reducedMotion';
import { countRows, filterGroups, PANES } from './settings/panes';
import { SettingsTitleBar } from './settings/SettingsTitleBar';
import { useSettings } from './settings/settings';
import type { GroupSpec, SettingsCtx } from './settings/types';
import { useHotkeyEditor } from './settings/useHotkeyEditor';

// Mirrors both the inner size and the minimum size `build_panel` gives this
// window in main/src-tauri/src/lib.rs — keep the two in step.
const WIDTH = 640;
const HEIGHT = 520;

function renderGroup(group: GroupSpec, ctx: SettingsCtx, prefix?: string) {
  return (
    <SettingsGroup
      key={`${prefix ?? ''}${group.id}`}
      label={prefix ? `${prefix} · ${group.label}` : group.label}
      hint={group.hint}
      onDiscard={group.changed ? group.onDiscard : undefined}
    >
      {group.rows.map((row) => (
        <SettingRow
          key={row.id}
          title={row.title}
          description={row.description}
          layout={row.layout}
          control={row.control(ctx)}
          footnote={row.footnote?.(ctx)}
        />
      ))}
    </SettingsGroup>
  );
}

export function SettingsWindow() {
  const settings = useSettings();
  const hotkeys = useHotkeyEditor();

  const [paneId, setPaneId] = useState(PANES[0].id);
  const [query, setQuery] = useState('');
  // Set when a pane is picked *while searching* and that pane had matches: the
  // query survives, narrowed to it. Any edit to the query goes back to all panes.
  const [scoped, setScoped] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [paths, setPaths] = useState<DataPaths | null>(null);
  const [presented, setPresented] = useState(false);

  const presentedRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lowPower = useLowPowerMode();
  const [systemPrefers, setSystemPrefers] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setSystemPrefers(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    let stale = false;
    void getVersion()
      .then((v) => {
        if (!stale) setVersion(v);
      })
      .catch(() => {
        // Leaves the About row showing a dash rather than a wrong number.
      });
    void api
      .dataPaths()
      .then((p) => {
        if (!stale) setPaths(p);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  // Size, center and fade the window in once the preferences have loaded
  // (StrictMode-safe, after fonts settle). The window is built fresh on open, so
  // this runs once per window. Fixed size; the pane scrolls.
  useEffect(() => {
    if (!settings.loaded || presentedRef.current) return;
    presentedRef.current = true;
    void document.fonts.ready.then(() => {
      void api.presentWindow(WIDTH, HEIGHT);
      setPresented(true);
    });
  }, [settings.loaded]);

  // Escape backs out one level — first the search, then the window. A recording
  // hotkey swallows both (useHotkeyEditor listens in the capture phase).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (query) clearSearch();
        else void getCurrentWindow().close();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query]);

  const activePane = PANES.find((p) => p.id === paneId) ?? PANES[0];
  const searching = query.trim().length > 0;

  const ctx: SettingsCtx = {
    values: settings.values,
    set: settings.set,
    changedSince: settings.changedSince,
    discard: settings.discard,
    resetAll: () => {
      settings.resetAll();
      hotkeys.resetAll();
    },
    hotkeys,
    version,
    paths,
    motion: { lowPower, systemPrefers },
  };

  // Searching spans every pane, so the answer is never hidden behind the pane you
  // didn't think to open.
  const results = searching
    ? PANES.map((pane) => ({
        pane,
        groups: filterGroups(pane.groups(ctx), query),
      })).filter((r) => r.groups.length > 0)
    : [];

  const matchesIn = (id: string) =>
    results.find((r) => r.pane.id === id)?.groups ?? [];

  function clearSearch() {
    setQuery('');
    setScoped(false);
  }

  function search(next: string) {
    setQuery(next);
    setScoped(false);
  }

  // Picking a pane that has hits keeps the query and narrows to that pane; only a
  // pane with nothing to show for it drops the search.
  function selectPane(id: string) {
    setPaneId(id);
    if (matchesIn(id).length > 0) setScoped(true);
    else clearSearch();
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function onNavKeys(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = PANES.findIndex((p) => p.id === activePane.id);
    const next = PANES[(at + step + PANES.length) % PANES.length];
    selectPane(next.id);
    navRef.current
      ?.querySelector<HTMLElement>(`#settings-tab-${next.id}`)
      ?.focus();
  }

  const dirtySession = settings.changed || hotkeys.changed;
  const scopedGroups = searching && scoped ? matchesIn(activePane.id) : [];

  return (
    <div className="bg-surface-1l dark:bg-surface-1d h-screen w-screen overflow-hidden">
      <div
        className={cn(
          'flex h-full flex-col',
          presented ? 'animate-scale-in' : 'opacity-0'
        )}
      >
        <SettingsTitleBar
          trailing={
            dirtySession && (
              <IconButton
                icon="undo"
                size="xl"
                radius="control"
                iconSize={19}
                iconWeight={300}
                variant="ghostStrong"
                title="Discard every change made since this window opened"
                aria-label="Discard changes"
                onClick={() => {
                  settings.discardAll();
                  hotkeys.discardAll();
                }}
              />
            )
          }
        />

        <div className="flex min-h-0 flex-1">
          <nav className="border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d gap-space-6 p-space-5 flex w-44 shrink-0 flex-col border-r">
            <InputWell
              className="h-7"
              leading={<Icon name="search" size={14} />}
              trailing={
                query && (
                  <IconButton
                    icon="close"
                    size="sm"
                    iconSize={14}
                    variant="plain"
                    title="Clear search"
                    aria-label="Clear search"
                    onClick={clearSearch}
                  />
                )
              }
            >
              <TextInput
                bare
                ref={searchRef}
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder="Search"
                aria-label="Search settings"
                className="text-[12px]"
              />
            </InputWell>

            <div
              ref={navRef}
              role="tablist"
              aria-orientation="vertical"
              aria-label="Settings sections"
              onKeyDown={onNavKeys}
              className="gap-space-1 flex flex-col"
            >
              {PANES.map((pane) => {
                const matches = searching ? countRows(matchesIn(pane.id)) : 0;
                const selected = pane.id === activePane.id;
                return (
                  <MenuItem
                    key={pane.id}
                    id={`settings-tab-${pane.id}`}
                    role="tab"
                    rounded
                    active={selected && (!searching || scoped)}
                    aria-selected={selected}
                    aria-controls={
                      selected ? `settings-panel-${pane.id}` : undefined
                    }
                    tabIndex={selected ? 0 : -1}
                    leading={<Icon name={pane.icon} size={16} />}
                    trailing={
                      matches > 0 && (
                        <Badge tone="recessed" size="sm">
                          {matches}
                        </Badge>
                      )
                    }
                    className={cn(searching && matches === 0 && 'opacity-40')}
                    onClick={() => selectPane(pane.id)}
                  >
                    {pane.label}
                  </MenuItem>
                );
              })}
            </div>
          </nav>

          <div
            ref={scrollRef}
            role="tabpanel"
            id={`settings-panel-${activePane.id}`}
            aria-labelledby={`settings-tab-${activePane.id}`}
            className="bg-surface-2l dark:bg-surface-2d px-space-8 py-space-7 min-h-0 flex-1 overflow-y-auto"
          >
            <div
              key={
                searching
                  ? scoped
                    ? `scoped-${activePane.id}`
                    : 'search'
                  : activePane.id
              }
              className="animate-panel-in gap-space-8 flex min-h-full flex-col"
            >
              {!searching ? (
                <>
                  {activePane.intro && (
                    <Label as="p" tone="muted" className="text-[12px]">
                      {activePane.intro}
                    </Label>
                  )}
                  {activePane
                    .groups(ctx)
                    .map((group) => renderGroup(group, ctx))}
                </>
              ) : scoped ? (
                scopedGroups.map((group) => renderGroup(group, ctx))
              ) : results.length > 0 ? (
                results.flatMap((r) =>
                  r.groups.map((group) => renderGroup(group, ctx, r.pane.label))
                )
              ) : (
                <EmptyState
                  icon="search"
                  title="No settings match"
                  subtitle={`Nothing here for “${query.trim()}”.`}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
