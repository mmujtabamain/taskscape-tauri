import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@taskscape/common-ui/Icon";
import { RichTextEditor, type RichTextHandle } from "@taskscape/common-ui/RichTextEditor";
import { Spinner } from "@taskscape/common-ui/Spinner";
import { api, type CaptureTarget } from "./api";

const inputClasses =
  "min-w-0 bg-transparent text-sm outline-none " +
  "text-content-1l placeholder:text-content-3l " +
  "dark:text-content-1d dark:placeholder:text-content-3d";

const ghostButtonBase =
  "flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-xs transition " +
  "hover:bg-surface-1l dark:hover:bg-surface-1d " +
  "disabled:cursor-default disabled:hover:bg-transparent";

function App() {
  const [title, setTitle] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextHandle>(null);

  const refreshTarget = () => {
    api.captureTarget().then(setTarget).catch(() => {});
  };
  const focusTitle = () =>
    requestAnimationFrame(() => titleRef.current?.focus());

  useEffect(() => {
    refreshTarget();
    const subs = [
      // Summoned: refocus the title field and refresh the target name.
      listen("mini-shown", () => {
        refreshTarget();
        focusTitle();
      }),
      // Dismissed/submitted: the draft is gone, so reset the form.
      listen("mini-reset", () => {
        setTitle("");
        editorRef.current?.clear();
        setScreenshots([]);
        setPending(0);
        setError(null);
      }),
      // A capture is in flight (button or ⌘⇧Return) — show the spinner.
      listen("screenshot-pending", () => {
        setError(null);
        setPending((n) => n + 1);
      }),
      // Capture landed — attach it and drop the spinner.
      listen<string>("screenshot-captured", (e) => {
        setPending((n) => Math.max(0, n - 1));
        setScreenshots((prev) => [...prev, e.payload]);
        focusTitle();
      }),
      // Capture failed (e.g. Screen Recording permission) — surface it briefly.
      listen<string>("screenshot-error", (e) => {
        setPending((n) => Math.max(0, n - 1));
        setError(e.payload || "Screenshot failed");
        focusTitle();
      }),
    ];
    return () => {
      subs.forEach((s) => s.then((fn) => fn()));
    };
  }, []);

  // Clear a surfaced capture error after a few seconds.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    const notesHtml = editorRef.current?.isEmpty()
      ? null
      : (editorRef.current?.getHtml() ?? null);
    await api.submitCapture({
      title: t,
      notes: notesHtml,
      screenshotPaths: screenshots,
    });
    setTitle("");
    editorRef.current?.clear();
    setScreenshots([]);
  };

  // Not a toggle: every trigger captures and attaches another screenshot. The
  // work happens in the background and reports back via the `screenshot-*` events.
  const addScreenshot = () => {
    api.captureAndAttach().catch(() => {});
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
  const capturing = pending > 0;

  const shotTextColor = error
    ? "text-red-500 dark:text-red-400"
    : count && !capturing
      ? "text-accent-500 dark:text-accent-400"
      : "text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d";

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen w-screen flex-col overflow-hidden rounded-panel border border-edge-2l bg-surface-2l text-content-1l dark:border-edge-2d dark:bg-surface-2d dark:text-content-1d"
      onKeyDown={onKeyDown}
    >
      {/* Title row — just the task title now; the screenshot control lives in
          the footer so there's one clear home for it (and its spinner/count). */}
      <div data-tauri-drag-region className="flex items-center px-3 py-2">
        <input
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Capture a task ..."
          className={`flex-1 ${inputClasses}`}
        />
      </div>

      <div className="h-px shrink-0 bg-edge-2l dark:bg-edge-2d" />

      <RichTextEditor
        ref={editorRef}
        attachments={[]}
        placeholder="Notes ..."
        minHeightClass="min-h-16"
        floatingToolbar={false}
        wrapperClassName=""
        toolbarClassName="border-edge-1l dark:border-edge-1d gap-1 border-t px-2 py-1.5"
        onSubmit={save}
        onEscape={() => api.hideMini()}
      />

      <div className="h-px shrink-0 bg-edge-2l dark:bg-edge-2d" />

      {/* Footer — target (project / list, opens main) + the screenshot button. */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between gap-2 px-3 py-2"
      >
        <button
          onClick={() => api.openMain()}
          tabIndex={-1}
          className="flex min-w-0 items-center gap-2 text-xs text-content-2l transition hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d"
          title="Open the main Taskscape window"
        >
          <Icon name="open_in_new" size={14} />
          <span className="truncate">
            {target ? (
              <>
                {target.project && (
                  <span className="text-content-3l dark:text-content-3d">
                    {target.project}
                    <span className="px-1 opacity-60">/</span>
                  </span>
                )}
                {target.list}
              </>
            ) : (
              "Taskscape"
            )}
          </span>
        </button>

        <button
          onClick={addScreenshot}
          disabled={capturing}
          tabIndex={-1}
          className={`${ghostButtonBase} ${shotTextColor}`}
          title={
            capturing
              ? "Capturing screenshot …"
              : error
                ? error
                : count
                  ? `${count} screenshot${count > 1 ? "s" : ""} attached — add another (⌘⇧⏎)`
                  : "Attach a full-screen screenshot (⌘⇧⏎)"
          }
        >
          {capturing ? (
            <>
              <Spinner size={13} />
              <span>Capturing …</span>
            </>
          ) : error ? (
            <>
              <Icon name="error" size={15} />
              <span>Capture failed</span>
            </>
          ) : (
            <>
              <Icon name="screenshot_monitor" size={15} filled={count > 0} />
              <span>{count ? `${count} shot${count > 1 ? "s" : ""}` : "Screenshot"}</span>
              <kbd className="font-sans text-[11px] not-italic text-content-3l dark:text-content-3d">
                ⌘⇧⏎
              </kbd>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default App;
