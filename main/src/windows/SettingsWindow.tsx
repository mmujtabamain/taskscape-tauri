import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@taskscape/common-ui/Icon';
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

const PANES = [
  { id: 'general', label: 'General', icon: 'tune' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
] as const;
type PaneId = (typeof PANES)[number]['id'];

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-content-3l dark:text-content-3d text-[11px] font-semibold tracking-widest uppercase">
        {children}
      </span>
      <span className="border-edge-1l dark:border-edge-1d -mr-5 flex-1 border-t" />
    </div>
  );
}

function GeneralPane({
  theme,
  onTheme,
  showCompleted,
  onToggleCompleted,
}: {
  theme: ThemePref;
  onTheme: (next: ThemePref) => void;
  showCompleted: boolean;
  onToggleCompleted: () => void;
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionLabel>Appearance</SectionLabel>
        <div className="rounded-control bg-surface-0l dark:bg-surface-0d flex p-0.5">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onTheme(o.value)}
              className={`rounded-field h-7 flex-1 text-[12px] font-medium transition duration-150 ${
                theme === o.value
                  ? 'border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d text-content-1l dark:text-content-1d border'
                  : 'text-content-2l dark:text-content-2d hover:text-content-1l dark:hover:text-content-1d'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Tasks</SectionLabel>
        <div className="flex items-center justify-between">
          <span className="text-content-1l dark:text-content-1d text-[13px]">
            Show completed tasks
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={showCompleted}
            aria-label="Show completed tasks"
            onClick={onToggleCompleted}
            className={`relative h-5 w-8.5 shrink-0 rounded-full border transition-colors duration-160 ${
              showCompleted
                ? 'bg-accent-500l dark:bg-accent-500d border-transparent'
                : 'border-edge-2l dark:border-edge-2d bg-surface-0l dark:bg-surface-0d'
            }`}
          >
            <span
              className={`bg-surface-3l dark:bg-surface-3d absolute top-1/2 left-px h-4 w-4 -translate-y-1/2 rounded-full shadow-sm transition-transform duration-160 ${
                showCompleted ? 'translate-x-3.5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </section>
    </div>
  );
}

export function SettingsWindow() {
  const [pane, setPane] = useState<PaneId>('general');
  const [theme, setThemeChoice] = useState<ThemePref>('system');
  const [showCompleted, setShowCompleted] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [presented, setPresented] = useState(false);

  const presentedRef = useRef(false);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const [t, sc] = await Promise.all([
        api.getSetting('theme').catch(() => null),
        api.getSetting('show_completed').catch(() => null),
      ]);
      if (stale) return;
      if (t === 'system' || t === 'light' || t === 'dark') setThemeChoice(t);
      setShowCompleted(sc !== '0');
      setLoaded(true);
    })();
    return () => {
      stale = true;
    };
  }, []);

  // Size, center and reveal the hidden window exactly once, after fonts settle
  // (StrictMode-safe). The window is a fixed size; panes scroll internally.
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
          <h1
            data-tauri-drag-region
            className="font-display text-content-1l dark:text-content-1d text-[15px] font-semibold"
          >
            Settings
          </h1>
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => void getCurrentWindow().close()}
            className="rounded-field text-content-2l dark:text-content-2d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d ml-auto flex h-6 w-6 items-center justify-center transition duration-150"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="border-edge-1l dark:border-edge-1d w-40 shrink-0 space-y-0.5 border-r px-2 py-3">
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPane(p.id)}
                className={`rounded-field flex h-8 w-full items-center gap-2 px-2.5 text-[13px] font-medium transition duration-150 ${
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
              />
            ) : (
              <ShortcutsPane />
            )}
          </div>
        </div>

        <footer className="text-content-3l dark:text-content-3d shrink-0 pb-4 text-center text-[11px]">
          Taskscape 0.1.0
        </footer>
      </div>
    </div>
  );
}
