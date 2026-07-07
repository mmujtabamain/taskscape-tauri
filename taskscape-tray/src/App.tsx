import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";

interface CapturePayload {
  screenshot: string | null;
}

function App() {
  const [title, setTitle] = useState("");
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle("");
    setScreenshotPath(null);
    setPreview(null);
  };

  // The Rust side fires "capture-ready" each time the hotkey summons the window.
  useEffect(() => {
    const unlisten = listen<CapturePayload>("capture-ready", async (event) => {
      const path = event.payload.screenshot;
      setTitle("");
      setScreenshotPath(path);
      setPreview(null);
      if (path) {
        try {
          setPreview(await api.screenshotDataUrl(path));
        } catch {
          setPreview(null);
        }
      }
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
    reset();
  };

  const dismiss = async () => {
    await api.hideMini();
    reset();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  };

  return (
    <div
      className="flex h-screen w-screen flex-col bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
      onKeyDown={onKeyDown}
    >
      <header
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-800"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <div className="grid h-5 w-5 place-items-center rounded bg-indigo-600 text-[10px] font-bold text-white">
            T
          </div>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Quick Capture</span>
        </div>
        <button
          onClick={dismiss}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          title="Dismiss (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <input
          ref={inputRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />

        {preview && (
          <div className="group relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
            <img src={preview} alt="Screenshot" className="max-h-28 w-full object-cover object-top" />
            <button
              onClick={() => {
                setScreenshotPath(null);
                setPreview(null);
              }}
              className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
            >
              Remove
            </button>
            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
              Screenshot attached
            </span>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">Enter to save · Esc to dismiss</span>
          <button
            onClick={save}
            disabled={!title.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
