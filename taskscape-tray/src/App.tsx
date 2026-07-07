import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "./components/Icon";
import { api } from "./api";

function App() {
  const [title, setTitle] = useState("");
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshListName = () => {
    api.activeListName().then(setListName).catch(() => {});
  };

  // Focus the input and refresh the target-list name each time we're summoned.
  useEffect(() => {
    refreshListName();
    const unlisten = listen("mini-shown", () => {
      refreshListName();
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    await api.submitCapture({ title: t, screenshotPath });
    setTitle("");
    setScreenshotPath(null);
  };

  const toggleScreenshot = async () => {
    if (screenshotPath) {
      setScreenshotPath(null);
      return;
    }
    setBusy(true);
    try {
      setScreenshotPath(await api.captureAndAttach());
      requestAnimationFrame(() => inputRef.current?.focus());
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

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen w-screen flex-col justify-center gap-2 p-2.5 text-white"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Capture a task…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/30"
        />
        <button
          onClick={toggleScreenshot}
          disabled={busy}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition disabled:opacity-50 ${
            screenshotPath
              ? "border-indigo-400 bg-indigo-500 text-white"
              : "border-white/10 bg-white/10 text-white/70 hover:text-white"
          }`}
          title={screenshotPath ? "Screenshot attached — click to remove" : "Attach a full-screen screenshot"}
        >
          <Icon name="screenshot_monitor" size={18} filled={!!screenshotPath} />
        </button>
        <button
          onClick={() => api.openMain()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/10 text-white/70 transition hover:text-white"
          title="Open the main Taskscape window"
        >
          <Icon name="arrow_forward" size={18} />
        </button>
      </div>

      <button
        onClick={() => api.openMain()}
        className="flex w-fit items-center gap-1 pl-1 text-xs text-white/55 transition hover:text-white"
        title="Open the main Taskscape window"
      >
        <Icon name="folder_open" size={13} />
        <span className="max-w-95 truncate">{listName || "Taskscape"}</span>
        <Icon name="chevron_right" size={13} />
      </button>
    </div>
  );
}

export default App;
