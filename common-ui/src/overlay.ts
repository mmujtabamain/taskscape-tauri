// Shared mechanics for every overlay in both apps: the depth counter that lets
// window-level key handlers defer to whatever sits on top, and the dismiss
// wiring (Escape, outside press, window change) each one needs.
//
// `<Overlay>` composes all of this for full-window overlays. An *anchored*
// overlay that positions itself against its trigger — a dropdown hung off a
// button — uses `useDismissable` directly instead, because it has no scrim to
// catch outside presses.
import { useEffect, type RefObject } from 'react';

let depth = 0;

/** True while any overlay is on screen. The app's global key map checks this so
 *  an Escape that dismisses an overlay doesn't also act on what's behind it. */
export const overlayOpen = () => depth > 0;

/** Hold a slot in the overlay-depth count for this component's lifetime. */
export function useOverlayDepth(): void {
  useEffect(() => {
    depth++;
    return () => {
      depth = Math.max(0, depth - 1);
    };
  }, []);
}

export interface DismissableOptions {
  /** Omit to make the overlay non-dismissable (it still holds a depth slot). */
  onDismiss?: () => void;
  /** The overlay's own element: a pointer press outside it dismisses. Leave unset
   *  when a scrim already absorbs outside presses. */
  ref?: RefObject<HTMLElement | null>;
  /** Take Escape in the capture phase so a window-level handler never sees the
   *  same keystroke. Needed by overlays that share the window with the app's own
   *  key map and must not let it act on the same press. */
  capture?: boolean;
  /** Also dismiss when the window is blurred or resized — right for a menu
   *  pinned to a coordinate, wrong for anything holding unsaved input. */
  onWindowChange?: boolean;
}

/** Wires the ways out of an overlay — Escape, a press outside `ref`, and
 *  optionally a window blur/resize — and holds a depth slot while mounted. */
export function useDismissable({
  onDismiss,
  ref,
  capture = false,
  onWindowChange = false,
}: DismissableOptions): void {
  useOverlayDepth();

  useEffect(() => {
    if (!onDismiss) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (capture) e.stopPropagation();
      e.preventDefault();
      onDismiss();
    };
    const onPress = (e: MouseEvent) => {
      const el = ref?.current;
      if (el && !el.contains(e.target as Node)) onDismiss();
    };

    window.addEventListener('keydown', onKey, capture);
    if (ref) window.addEventListener('mousedown', onPress);
    if (onWindowChange) {
      window.addEventListener('blur', onDismiss);
      window.addEventListener('resize', onDismiss);
    }
    return () => {
      window.removeEventListener('keydown', onKey, capture);
      if (ref) window.removeEventListener('mousedown', onPress);
      if (onWindowChange) {
        window.removeEventListener('blur', onDismiss);
        window.removeEventListener('resize', onDismiss);
      }
    };
  }, [onDismiss, ref, capture, onWindowChange]);
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keeps Tab inside `ref` and hands focus back to whatever had it when the
 *  overlay opened.
 *
 *  The hand-back is skipped if anything *outside* the overlay took focus while it
 *  was open: a caller can resolve an overlay and immediately focus something else
 *  (the note editor re-focuses itself after the link sheet answers), and stealing
 *  focus back from it on unmount would undo that. */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;
    const opener = document.activeElement as HTMLElement | null;
    let claimedOutside = false;

    // Nothing inside asked for focus (a plain confirmation has no field) — park
    // it on the panel so Tab starts there and the dialog is announced.
    const frame = requestAnimationFrame(() => {
      const el = ref.current;
      if (el && !el.contains(document.activeElement)) el.focus();
    });

    const onFocusIn = (e: FocusEvent) => {
      const el = ref.current;
      const target = e.target as Node | null;
      if (!el || !target || target === document.body) return;
      claimedOutside = !el.contains(target);
    };

    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('keydown', onKey, true);
      if (!claimedOutside) opener?.focus?.();
    };
  }, [ref, enabled]);
}
