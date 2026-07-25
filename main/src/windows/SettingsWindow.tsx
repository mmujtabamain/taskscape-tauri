import { Icon } from '@taskscape/common-ui/Icon';
import {
  IconButton,
  Label,
  SectionHeader,
  Segmented,
  Toggle,
} from '@taskscape/common-ui/components';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { setTheme, type ThemePref } from '../lib/theme';
import { ShortcutsPane } from './ShortcutsPane';

const WIDTH = 640;
const HEIGHT = 520;

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

type ScreenshotMode = 'fullscreen' | 'region';

const SCREENSHOT_OPTIONS: { value: ScreenshotMode; label: string }[] = [
  { value: 'fullscreen', label: 'Full Screen' },
  { value: 'region', label: 'Region' },
];

const PANES = [
  { id: 'general', label: 'General', icon: 'tune' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
] as const;
type PaneId = (typeof PANES)[number]['id'];

function SectionLabel({ children }: { children: string }) {
  return <SectionHeader label={children} className="mb-0" />;
}

function GeneralPane({
  theme,
  onTheme,
  showCompleted,
  onToggleCompleted,
  screenshotMode,
  onScreenshotMode,
}: {
  theme: ThemePref;
  onTheme: (next: ThemePref) => void;
  showCompleted: boolean;
  onToggleCompleted: () => void;
  screenshotMode: ScreenshotMode;
  onScreenshotMode: (next: ScreenshotMode) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionLabel>Appearance</SectionLabel>
        <Segmented
          variant="surfaceThumb"
          items={THEME_OPTIONS}
          value={theme}
          onChange={onTheme}
        />
      </section>

      <section className="space-y-3">
        <SectionLabel>Screenshots</SectionLabel>
        <div className="space-y-1.5">
          <Segmented
            variant="surfaceThumb"
            items={SCREENSHOT_OPTIONS}
            value={screenshotMode}
            onChange={onScreenshotMode}
          />
          <Label as="p" tone="muted" className="text-[11px]">
            {screenshotMode === 'region'
              ? 'Drag to select an area, or press Space to grab a window. Esc cancels.'
              : 'Capture the entire screen instantly.'}
          </Label>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Tasks</SectionLabel>
        <div className="flex items-center justify-between">
          <Label tone="primary" className="text-[13px]">
            Show completed tasks
          </Label>
          <Toggle
            checked={showCompleted}
            onChange={onToggleCompleted}
            title="Show completed tasks"
          />
        </div>
      </section>
    </div>
  );
}

export function SettingsWindow() {
  const [pane, setPane] = useState<PaneId>('general');
  const [theme, setThemeChoice] = useState<ThemePref>('system');
  const [showCompleted, setShowCompleted] = useState(true);
  const [screenshotMode, setScreenshotMode] =
    useState<ScreenshotMode>('fullscreen');
  const [loaded, setLoaded] = useState(false);
  const [presented, setPresented] = useState(false);

  const presentedRef = useRef(false);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const [t, sc, sm] = await Promise.all([
        api.getSetting('theme').catch(() => null),
        api.getSetting('show_completed').catch(() => null),
        api.getSetting('screenshot_mode').catch(() => null),
      ]);
      if (stale) return;
      if (t === 'system' || t === 'light' || t === 'dark') setThemeChoice(t);
      setShowCompleted(sc !== '0');
      if (sm === 'region') setScreenshotMode('region');
      setLoaded(true);
    })();
    return () => {
      stale = true;
    };
  }, []);

  // Size, center and fade the window in once settings have loaded (StrictMode-safe,
  // after fonts settle). The window is built fresh on open, so this runs once per
  // window. Fixed size; panes scroll.
  useEffect(() => {
    if (!loaded || presentedRef.current) return;
    presentedRef.current = true;
    void document.fonts.ready.then(() => {
      void api.presentWindow(WIDTH, HEIGHT);
      setPresented(true);
    });
  }, [loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void getCurrentWindow().close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function chooseTheme(next: ThemePref) {
    setThemeChoice(next);
    void setTheme(next);
  }

  function chooseScreenshotMode(next: ScreenshotMode) {
    setScreenshotMode(next);
    void api.setSetting('screenshot_mode', next);
  }

  function toggleCompleted() {
    const next = !showCompleted;
    setShowCompleted(next);
    const value = next ? '1' : '0';
    void api
      .setSetting('show_completed', value)
      .then(() => emit('settings-changed', { key: 'show_completed', value }));
  }

  return (
    <div className="bg-surface-1l dark:bg-surface-1d flex h-screen w-screen flex-col overflow-hidden">
      <style>
        {
          '@keyframes settings-in { from { opacity: 0; transform: scale(0.97); } }'
        }
      </style>
      <div
        className="flex h-full flex-col"
        style={
          presented
            ? { animation: 'settings-in 180ms cubic-bezier(0.2, 0, 0, 1) both' }
            : { opacity: 0 }
        }
      >
        <header
          data-tauri-drag-region
          className="border-edge-2l dark:border-edge-2d flex h-11 shrink-0 items-center border-b px-4"
        >
          <Label
            as="h1"
            data-tauri-drag-region
            tone="primary"
            weight="semibold"
            className="font-display text-[15px]"
          >
            Settings
          </Label>
          <IconButton
            icon="close"
            iconSize={18}
            variant="ghostStrong"
            aria-label="Close settings"
            onClick={() => void getCurrentWindow().close()}
            className="ml-auto"
          />
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="border-edge-1l dark:border-edge-1d w-40 shrink-0 space-y-0.5 border-r px-2 py-3">
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPane(p.id)}
                className={`rounded-field flex h-8 w-full items-center gap-2 px-2.5 text-[13px] font-medium ${
                  pane === p.id
                    ? 'bg-wash-2l dark:bg-wash-2d text-content-1l dark:text-content-1d'
                    : 'text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d'
                }`}
              >
                <Icon name={p.icon} size={16} />
                {p.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {pane === 'general' ? (
              <GeneralPane
                theme={theme}
                onTheme={chooseTheme}
                showCompleted={showCompleted}
                onToggleCompleted={toggleCompleted}
                screenshotMode={screenshotMode}
                onScreenshotMode={chooseScreenshotMode}
              />
            ) : (
              <ShortcutsPane />
            )}
          </div>
        </div>

        <Label
          as="footer"
          tone="muted"
          className="shrink-0 pb-4 text-center text-[11px]"
        >
          Taskscape 0.1.0
        </Label>
      </div>
    </div>
  );
}
