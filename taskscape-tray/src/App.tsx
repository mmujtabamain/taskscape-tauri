import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "./components/Icon";
import { api } from "./api";

const fieldClasses =
  "rounded-control border px-3 py-2 text-sm outline-none " +
  "border-edge-2l bg-surface-1l text-content-1l placeholder:text-content-4l focus:border-edge-3l " +
  "dark:border-edge-2d dark:bg-surface-1d dark:text-content-1d dark:placeholder:text-content-4d dark:focus:border-edge-3d";

const iconButtonClasses =
  "grid h-9 w-9 shrink-0 place-items-center rounded-control border transition " +
  "border-edge-1l bg-surface-1l text-content-2l hover:text-content-1l " +
  "dark:border-edge-1d dark:bg-surface-1d dark:text-content-2d dark:hover:text-content-1d";

function App() {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listName, setListName] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const refreshListName = () => {
    api.activeListName().then(setListName).catch(() => {});
  };
  const focusTitle = () => requestAnimationFrame(() => titleRef.current?.focus());

  useEffect(() => {
    refreshListName();
    const subs = [
      // Summoned: refocus the title field and refresh the target-list name.
      listen("mini-shown", () => {
        refreshListName();
        focusTitle();
      }),
      // Dismissed/submitted: the draft is gone, so reset the form.
      listen("mini-reset", () => {
        setTitle("");
        setNotes("");
        setScreenshots([]);
      }),
      // ⌘⇧Return captured a screenshot in the background — attach it.
      listen<string>("screenshot-captured", (e) => {
        setScreenshots((prev) => [...prev, e.payload]);
        focusTitle();
      }),
    ];
    return () => {
      subs.forEach((s) => s.then((fn) => fn()));
    };
  }, []);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    await api.submitCapture({ title: t, notes: notes.trim() || null, screenshotPaths: screenshots });
    setTitle("");
    setNotes("");
    setScreenshots([]);
  };

  // Not a toggle: every click captures and attaches another screenshot.
  const addScreenshot = async () => {
    setBusy(true);
    try {
      const path = await api.captureAndAttach();
      setScreenshots((prev) => [...prev, path]);
      focusTitle();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      api.hideMini();
    }
  };

  const count = screenshots.length;

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen w-screen flex-col justify-center gap-2 rounded-panel p-2.5 text-content-1l dark:text-content-1d"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={addScreenshot}
          disabled={busy}
          tabIndex={-1}
          className={`relative ${
            count
              ? "grid h-9 w-9 shrink-0 place-items-center rounded-control border border-accent-400 bg-accent-500 text-on-accent transition disabled:opacity-50"
              : `${iconButtonClasses} disabled:opacity-50`
          }`}
          title={
            count
              ? `${count} screenshot${count > 1 ? "s" : ""} attached — click to add another (⌘⇧⏎)`
              : "Attach a full-screen screenshot (⌘⇧⏎)"
          }
        >
          <Icon name="screenshot_monitor" size={18} filled={count > 0} />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-semibold leading-none text-on-accent ring-2 ring-halo-1l dark:ring-halo-1d">
              {count}
            </span>
          )}
        </button>

        <input
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Capture a task ..."
          className={`min-w-0 flex-1 ${fieldClasses}`}
        />
      </div>

      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Press Tab to add notes"
        className={`w-full ${fieldClasses}`}
      />

      <button
        onClick={() => api.openMain()}
        tabIndex={-1}
        className="flex w-full items-center gap-1 pl-1 text-xs text-content-3l transition hover:text-content-1l dark:text-content-3d dark:hover:text-content-1d"
        title="Open the main Taskscape window"
      >
        <Icon name="open_in_new" size={13} />
        <span className="max-w-95 truncate">{listName || "Taskscape"}</span>
        <Icon name="chevron_right" size={13} />
      </button>
    </div>
  );
}

export default App;
