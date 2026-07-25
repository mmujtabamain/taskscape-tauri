import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { api } from '../api';
import { applyAnchor, hideCard } from '../lib/anchor';
import { refreshTheme } from '../lib/theme';
import type { CaptureDraft } from './useCaptureDraft';

/** Wire the Rust-driven events the bar responds to: reveal (`mini-shown`), the
 *  global ⌘Enter forward (`capture-enter`), and the `screenshot-*` progress
 *  events. Every callback here is a stable `useEvent`, so the listeners register
 *  once and always see the latest state. */
export function useCaptureBarEvents(
  draft: CaptureDraft,
  onReveal: () => void
): void {
  const { focusDraft, save } = draft;
  const { pending, captured, cancelled, error } = draft.screenshotEvents;
  useEffect(() => {
    const subs = [
      // Summoned: pin the card to the window edge Rust chose for this reveal
      // (which also reveals it), refresh the target/hotkeys/theme (via onReveal)
      // and refocus.
      listen<string>('mini-shown', (e) => {
        applyAnchor(e.payload);
        onReveal();
        void refreshTheme();
        focusDraft();
      }),
      // Dismissed: hide the card so the next reveal can re-anchor it flash-free.
      listen('mini-hidden', () => hideCard()),
      // ⌘Enter while the bar is open (global; can't reach the webview, so Rust
      // forwards it): submit when the notes editor is focused, else dismiss.
      listen('capture-enter', () => {
        if ((document.activeElement as HTMLElement | null)?.isContentEditable)
          save();
        else api.hideMini();
      }),
      // Capture lifecycle: a capture is in flight, landed, was cancelled, or failed.
      listen('screenshot-pending', () => pending()),
      listen<string>('screenshot-captured', (e) => captured(e.payload)),
      listen('screenshot-cancelled', () => cancelled()),
      listen<string>('screenshot-error', (e) => error(e.payload)),
    ];
    return () => {
      subs.forEach((s) => s.then((fn) => fn()));
    };
  }, [onReveal, focusDraft, save, pending, captured, cancelled, error]);
}
