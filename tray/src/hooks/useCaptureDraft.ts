import { type RichTextHandle } from '@taskscape/common-ui/RichTextEditor';
import { useEvent } from '@taskscape/common-ui/useEvent';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';

/** Handlers the Rust `screenshot-*` events drive into the draft. */
export interface ScreenshotEvents {
  pending: () => void;
  captured: (path: string) => void;
  cancelled: () => void;
  error: (msg: string) => void;
}

export interface CaptureDraft {
  title: string;
  setTitle: (v: string) => void;
  notesOpen: boolean;
  setNotesOpen: (v: boolean) => void;
  count: number;
  capturing: boolean;
  error: string | null;
  hasDraft: boolean;
  titleRef: RefObject<HTMLInputElement | null>;
  editorRef: RefObject<RichTextHandle | null>;
  focusTitle: () => void;
  focusDraft: () => void;
  clearDraft: () => void;
  save: () => void;
  addScreenshot: () => void;
  screenshotEvents: ScreenshotEvents;
}

/** All state for the in-progress capture: the title, the (collapsible) notes
 *  editor, attached screenshots, the in-flight capture count, and any surfaced
 *  error — plus the actions that mutate them (`save`, `clearDraft`, screenshot
 *  event appliers). The refs the reveal/enter listeners read are replaced by
 *  stable `useEvent` callbacks that always see the latest state. */
export function useCaptureDraft(): CaptureDraft {
  const [title, setTitle] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextHandle>(null);

  const focusTitle = useEvent(() =>
    requestAnimationFrame(() => titleRef.current?.focus())
  );
  // On reveal, land the caret where the draft was left: in the notes editor if it
  // already holds a note, otherwise the title field.
  const focusDraft = useEvent(() =>
    requestAnimationFrame(() => {
      if (notesOpen && !editorRef.current?.isEmpty()) editorRef.current?.focus();
      else titleRef.current?.focus();
    })
  );

  // Wipe the draft back to an empty capture. Runs on submit and on an explicit
  // clear — never on a plain dismiss, so a half-typed capture survives hiding the
  // bar and returns on the next reveal.
  const clearDraft = useCallback(() => {
    setTitle('');
    setNotesOpen(false);
    editorRef.current?.clear();
    setScreenshots([]);
    setPending(0);
    setError(null);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  const save = useEvent(async () => {
    const t = title.trim();
    if (!t) return;
    const notesHtml = editorRef.current?.isEmpty()
      ? null
      : (editorRef.current?.getHtml() ?? null);
    await api.submitCapture({ title: t, notes: notesHtml, screenshotPaths: screenshots });
    clearDraft();
  });

  // Not a toggle: every trigger captures and attaches another screenshot. The work
  // happens in the background and reports back via the `screenshot-*` events.
  const addScreenshot = useCallback(() => {
    api.captureAndAttach().catch(() => {});
  }, []);

  // Clear a surfaced capture error after a few seconds.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(t);
  }, [error]);

  const screenshotEvents: ScreenshotEvents = {
    pending: useEvent(() => {
      setError(null);
      setPending((n) => n + 1);
    }),
    captured: useEvent((path: string) => {
      setPending((n) => Math.max(0, n - 1));
      setScreenshots((prev) => [...prev, path]);
      focusTitle();
    }),
    cancelled: useEvent(() => {
      setPending((n) => Math.max(0, n - 1));
      focusTitle();
    }),
    error: useEvent((msg: string) => {
      setPending((n) => Math.max(0, n - 1));
      setError(msg || 'Screenshot failed');
      focusTitle();
    }),
  };

  const count = screenshots.length;
  const capturing = pending > 0;
  // Something worth clearing. Empty draft → no Clear button, no clutter.
  const hasDraft = title.trim().length > 0 || count > 0 || notesOpen;

  return {
    title,
    setTitle,
    notesOpen,
    setNotesOpen,
    count,
    capturing,
    error,
    hasDraft,
    titleRef,
    editorRef,
    focusTitle,
    focusDraft,
    clearDraft,
    save,
    addScreenshot,
    screenshotEvents,
  };
}
