import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { setTheme, type ThemePref } from "../lib/theme";

const WIDTH = 520;
const MAX_HEIGHT = 640;

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SHORTCUTS: { label: string; keys: string; global?: boolean }[] = [
  { label: "Capture bar", keys: "⌘↩", global: true },
  { label: "Screenshot capture", keys: "⌘⇧↩", global: true },
  { label: "New task", keys: "⌘N" },
  { label: "Search", keys: "⌘F" },
  { label: "Switch list", keys: "⌘1–9" },
  { label: "Toggle preview", keys: "⌘\\" },
  { label: "Settings", keys: "⌘," },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-ink-3">
        {children}
      </span>
      <span className="-mr-5 flex-1 border-t border-hairline-faint" />
    </div>
  );
}

export function SettingsWindow() {
  const [theme, setThemeChoice] = useState<ThemePref>("system");
  const [showCompleted, setShowCompleted] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [presented, setPresented] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const presentedRef = useRef(false);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const [t, sc] = await Promise.all([
        api.getSetting("theme").catch(() => null),
        api.getSetting("show_completed").catch(() => null),
      ]);
      if (stale) return;
      if (t === "system" || t === "light" || t === "dark") setThemeChoice(t);
      setShowCompleted(sc !== "0");
      setLoaded(true);
    })();
    return () => {
      stale = true;
    };
  }, []);

  // Measure after fonts settle, then size, center and reveal the hidden
  // window exactly once (StrictMode-safe).
  useEffect(() => {
    if (!loaded || presentedRef.current) return;
    presentedRef.current = true;
    void document.fonts.ready.then(() => {
      const height =
        (headerRef.current?.offsetHeight ?? 44) +
        (bodyRef.current?.scrollHeight ?? 0) +
        (footerRef.current?.offsetHeight ?? 0);
      void api.presentWindow(WIDTH, Math.min(height, MAX_HEIGHT));
      setPresented(true);
    });
  }, [loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void getCurrentWindow().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function chooseTheme(next: ThemePref) {
    setThemeChoice(next);
    void setTheme(next);
  }

  function toggleCompleted() {
    const next = !showCompleted;
    setShowCompleted(next);
    const value = next ? "1" : "0";
    void api
      .setSetting("show_completed", value)
      .then(() => emit("settings-changed", { key: "show_completed", value }));
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-window">
      <style>{"@keyframes settings-in { from { opacity: 0; transform: scale(0.97); } }"}</style>
      <div
        className="flex h-full flex-col"
        style={
          presented
            ? { animation: "settings-in 180ms cubic-bezier(0.2, 0, 0, 1) both" }
            : { opacity: 0 }
        }
      >
        <header
          ref={headerRef}
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center border-b border-hairline px-4"
        >
          <h1 data-tauri-drag-region className="font-display text-[15px] font-semibold text-ink">
            Settings
          </h1>
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => void getCurrentWindow().close()}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-ink-2 transition duration-150 hover:bg-wash-strong hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div ref={bodyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <SectionLabel>Appearance</SectionLabel>
            <div className="flex rounded-lg bg-recessed p-0.5">
              {THEME_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => chooseTheme(o.value)}
                  className={`h-7 flex-1 rounded-[6px] text-[12px] font-medium transition duration-150 ${
                    theme === o.value
                      ? "border border-hairline bg-raised text-ink"
                      : "text-ink-2 hover:text-ink"
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
              <span className="text-[13px] text-ink">Show completed tasks</span>
              <button
                type="button"
                role="switch"
                aria-checked={showCompleted}
                aria-label="Show completed tasks"
                onClick={toggleCompleted}
                className={`relative h-5 w-[34px] shrink-0 rounded-full border transition-colors duration-[160ms] ${
                  showCompleted ? "border-transparent bg-accent" : "border-hairline bg-recessed"
                }`}
              >
                <span
                  className={`absolute top-1/2 left-px h-4 w-4 -translate-y-1/2 rounded-full bg-raised shadow-sm transition-transform duration-[160ms] ${
                    showCompleted ? "translate-x-[14px]" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <SectionLabel>Shortcuts</SectionLabel>
            <div className="space-y-2">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between text-[12.5px] text-ink-2"
                >
                  <span>{s.label}</span>
                  <span className="flex items-center gap-1.5">
                    {s.global && (
                      <span className="text-[10px] tracking-[0.08em] uppercase text-ink-3">
                        global
                      </span>
                    )}
                    <kbd className="inline-flex h-5 items-center rounded border border-hairline bg-recessed px-1.5 font-sans text-[11px] text-ink-2 tabular-nums">
                      {s.keys}
                    </kbd>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer ref={footerRef} className="shrink-0 pb-4 text-center text-[11px] text-ink-3">
          Taskscape 0.1.0
        </footer>
      </div>
    </div>
  );
}
