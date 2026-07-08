import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";
import { isMac } from "../lib/platform";

function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);
  return focused;
}

/** Custom-drawn traffic lights: red/yellow/green wells that gray out when the
 *  window blurs, glyphs on group hover — no private API involved. */
function MacControls() {
  const focused = useWindowFocused();
  const win = getCurrentWindow();

  const lights: Array<{ color: string; glyph: React.ReactNode; label: string; act: () => void }> = [
    {
      color: "#ff5f57",
      label: "Close",
      act: () => void win.close(),
      glyph: (
        <svg viewBox="0 0 8 8" className="h-2 w-2">
          <path d="M1.5 1.5 6.5 6.5 M6.5 1.5 1.5 6.5" stroke="rgba(0,0,0,0.55)" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      color: "#febc2e",
      label: "Minimize",
      act: () => void win.minimize(),
      glyph: (
        <svg viewBox="0 0 8 8" className="h-2 w-2">
          <path d="M1.2 4 H6.8" stroke="rgba(0,0,0,0.55)" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      color: "#28c840",
      label: "Full Screen",
      act: () => {
        win.isFullscreen().then((f) => win.setFullscreen(!f));
      },
      glyph: (
        <svg viewBox="0 0 8 8" className="h-2 w-2">
          <path d="M1.6 4.6 V6.4 H3.4 Z M6.4 3.4 V1.6 H4.6 Z" fill="rgba(0,0,0,0.55)" />
        </svg>
      ),
    },
  ];

  return (
    <div className="group flex items-center gap-2 pr-3 pl-5" data-no-drag>
      {lights.map((l) => (
        <button
          key={l.label}
          onClick={l.act}
          title={l.label}
          className="grid h-3 w-3 place-items-center rounded-full border border-black/10"
          style={{ backgroundColor: focused ? l.color : "var(--bg-recessed)" }}
        >
          <span className="opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            {l.glyph}
          </span>
        </button>
      ))}
    </div>
  );
}

function WinControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    const sync = () => win.isMaximized().then(setMaximized);
    sync();
    let unlisten: (() => void) | undefined;
    win.onResized(sync).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [win]);

  const base =
    "flex h-full w-[46px] items-center justify-center text-ink-2 transition-colors duration-100";
  return (
    <div className="flex h-full items-stretch" data-no-drag>
      <button className={`${base} hover:bg-wash-strong`} onClick={() => win.minimize()} title="Minimize">
        <Icon name="remove" size={16} />
      </button>
      <button
        className={`${base} hover:bg-wash-strong`}
        onClick={() => win.toggleMaximize()}
        title={maximized ? "Restore" : "Maximize"}
      >
        <Icon name={maximized ? "filter_none" : "crop_square"} size={14} />
      </button>
      <button
        className={`${base} hover:bg-[#e81123] hover:text-white`}
        onClick={() => win.close()}
        title="Close"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function WindowControls() {
  return isMac ? <MacControls /> : <WinControls />;
}
