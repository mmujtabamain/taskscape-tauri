import { Icon } from '@taskscape/common-ui/Icon';
import {
  RichTextEditor,
  type RichTextHandle,
} from '@taskscape/common-ui/RichTextEditor';
import { Spinner } from '@taskscape/common-ui/Spinner';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { api, type CaptureTarget } from './api';

const inputClasses =
  'min-w-0 bg-transparent text-sm outline-none ' +
  'text-content-1l placeholder:text-content-3l ' +
  'dark:text-content-1d dark:placeholder:text-content-3d';

const ghostButtonBase =
  'flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-xs transition ' +
  'hover:bg-surface-1l dark:hover:bg-surface-1d ' +
  'disabled:cursor-default disabled:hover:bg-transparent';

function App() {
  const [title, setTitle] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextHandle>(null);

  const refreshTarget = () => {
    api
      .captureTarget()
      .then(setTarget)
      .catch(() => {});
  };
  const focusTitle = () =>
    requestAnimationFrame(() => titleRef.current?.focus());

  // Wipe the draft back to an empty capture. Runs on submit and on an explicit
  // clear (the Clear button / ⌘⇧⌫) — never on a plain dismiss, so a half-typed
  // capture survives hiding the bar and returns on the next reveal.
  const clearDraft = useCallback(() => {
    setTitle('');
    setNotesOpen(false);
    editorRef.current?.clear();
    setScreenshots([]);
    setPending(0);
    setError(null);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  useEffect(() => {
    refreshTarget();
    const subs = [
      // Summoned: refocus the title field and refresh the target name.
      listen('mini-shown', () => {
        refreshTarget();
        focusTitle();
      }),
      // A capture is in flight (button or ⌘⇧Return) — show the spinner.
      listen('screenshot-pending', () => {
        setError(null);
        setPending((n) => n + 1);
      }),
      // Capture landed — attach it and drop the spinner.
      listen<string>('screenshot-captured', (e) => {
        setPending((n) => Math.max(0, n - 1));
        setScreenshots((prev) => [...prev, e.payload]);
        focusTitle();
      }),
      // Capture failed (e.g. Screen Recording permission) — surface it briefly.
      listen<string>('screenshot-error', (e) => {
        setPending((n) => Math.max(0, n - 1));
        setError(e.payload || 'Screenshot failed');
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

  // ⌘⇧⌫ clears the draft from anywhere in the bar. A capture-phase listener on
  // window fires before the title field's and the notes editor's own key
  // handling (the editor stops React propagation), so it works in either field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.metaKey &&
        e.shiftKey &&
        (e.key === 'Backspace' || e.key === 'Delete')
      ) {
        e.preventDefault();
        e.stopPropagation();
        clearDraft();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true });
  }, [clearDraft]);

  // Hide the mouse pointer when the bar opens (it lands right on the title field)
  // and while typing, and bring it straight back on any real mouse movement — so
  // it's only ever hidden mid-keystroke or freshly-opened, never while you're
  // reaching for a control. Toggled via a class on <html> (imperatively, no
  // re-render) so it stays snappy; mouse-move only ever *shows*, which killed the
  // old hover lag.
  useEffect(() => {
    const root = document.documentElement;
    let hidden = false;
    let revealAt = 0;
    const hide = () => {
      if (!hidden) {
        hidden = true;
        root.classList.add('cursor-hidden');
      }
    };
    const show = () => {
      if (hidden) {
        hidden = false;
        root.classList.remove('cursor-hidden');
      }
    };
    const onMove = () => {
      // Ignore the settling mouse events macOS fires as the panel appears under a
      // stationary pointer; only a move after the grace reveals the cursor.
      if (performance.now() - revealAt < 250) return;
      show();
    };
    const reveal = () => {
      revealAt = performance.now();
      hide();
    };
    window.addEventListener('keydown', hide);
    window.addEventListener('mousemove', onMove, { passive: true });
    // Rust emits `mini-shown` on every reveal — hide until the mouse moves.
    const shown = listen('mini-shown', reveal);
    return () => {
      window.removeEventListener('keydown', hide);
      window.removeEventListener('mousemove', onMove);
      shown.then((un) => un());
      root.classList.remove('cursor-hidden');
    };
  }, []);

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
    clearDraft();
  };

  // Not a toggle: every trigger captures and attaches another screenshot. The
  // work happens in the background and reports back via the `screenshot-*` events.
  const addScreenshot = () => {
    api.captureAndAttach().catch(() => {});
  };

  // The editor stops its own keydowns from bubbling here, so this only ever sees
  // the title field (and the footer, which isn't tabbable).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.hideMini();
    } else if (e.key === 'Tab' && !e.shiftKey && !notesOpen) {
      e.preventDefault();
      setNotesOpen(true);
    }
  };

  const count = screenshots.length;
  const capturing = pending > 0;
  // Something is worth clearing (and the pointer's over the field so the Clear
  // affordance is discoverable). Empty draft → no button, no clutter.
  const hasDraft = title.trim().length > 0 || count > 0 || notesOpen;

  const shotTextColor = error
    ? 'text-red-500 dark:text-red-400'
    : count && !capturing
      ? 'text-accent-500 dark:text-accent-400'
      : 'text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d';

  return (
    // The window is taller than the collapsed card; the card sizes to its own
    // content and the rest of the (transparent) window shows through.
    <div
      data-tauri-drag-region
      className="rounded-panel border-edge-2l bg-surface-2l text-content-1l dark:border-edge-2d dark:bg-surface-2d dark:text-content-1d flex w-screen flex-col overflow-hidden border"
      onKeyDown={onKeyDown}
    >
      {/* Title row — just the task title now; the screenshot control lives in
          the footer so there's one clear home for it (and its spinner/count). */}
      <div data-tauri-drag-region className="flex h-10 items-center px-3 py-2">
        <input
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Capture a task ..."
          className={`flex-1 ${inputClasses}`}
        />

        {hasDraft && (
          <button
            onClick={clearDraft}
            tabIndex={-1}
            className={twMerge(
              ghostButtonBase,
              'gap-0 text-[11px]',
              'text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d'
            )}
            title="Clear the draft (⌘⇧⌫)"
          >
            <Icon name="delete_sweep" size={16} />
            <p className="px-1">Clear</p>
            <kbd className="text-content-3l dark:text-content-3d font-sans text-[11px] not-italic">
              ⌘⇧⌫
            </kbd>
          </button>
        )}
      </div>

      <div className="bg-edge-2l dark:bg-edge-2d h-px shrink-0" />

      {notesOpen ? (
        <div className="min-h-0 overflow-hidden">
          <RichTextEditor
            ref={editorRef}
            autoFocus
            attachments={[]}
            placeholder="Notes ..."
            minHeightClass="min-h-16"
            floatingToolbar={false}
            wrapperClassName=""
            toolbarClassName="border-edge-1l dark:border-edge-1d gap-1 border-t px-2 py-1.5"
            onSubmit={save}
            onEscape={() => api.hideMini()}
            // Leaving the notes empty collapses the panel back to the hint —
            // toolbar clicks preventDefault their blur, so they don't trip this.
            onBlur={() => {
              if (editorRef.current?.isEmpty()) setNotesOpen(false);
            }}
          />
          <div className="bg-edge-2l dark:bg-edge-2d h-px" />
        </div>
      ) : (
        <div className="min-h-0 overflow-hidden">
          <button
            onClick={() => setNotesOpen(true)}
            className="text-content-3l dark:text-content-3d px-3 py-2 text-xs"
          >
            Press Tab to add a note
          </button>
          <div className="bg-edge-2l dark:bg-edge-2d h-px" />
        </div>
      )}

      {/* Footer — target (project / list, opens main) + the screenshot button. */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between gap-2 px-3 py-2"
      >
        <button
          onClick={() => api.openMain()}
          tabIndex={-1}
          className="text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d flex min-w-0 items-center gap-1.5 text-xs transition-colors"
          title="Open the main Taskscape window"
        >
          <Icon name="open_in_new" size={14} />
          <span className="truncate">
            {target ? (
              <>
                {target.project && (
                  <span className="">
                    {target.project}
                    <span className="px-1 opacity-60">/</span>
                  </span>
                )}
                {target.list}
              </>
            ) : (
              'Taskscape'
            )}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={addScreenshot}
            disabled={capturing}
            tabIndex={-1}
            className={`${ghostButtonBase} ${shotTextColor}`}
            title={
              capturing
                ? 'Capturing screenshot …'
                : error
                  ? error
                  : count
                    ? `${count} screenshot${count > 1 ? 's' : ''} attached — add another (⌘⇧⏎)`
                    : 'Attach a full-screen screenshot (⌘⇧⏎)'
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
                <span>
                  {count
                    ? `${count} shot${count > 1 ? 's' : ''}`
                    : 'Screenshot'}
                </span>
                <kbd className="text-content-3l dark:text-content-3d font-sans text-[11px] not-italic">
                  ⌘⇧⏎
                </kbd>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
