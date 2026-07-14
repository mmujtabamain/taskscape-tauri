import { useSyncExternalStore } from 'react';

// Whether Option/Alt is held right now. The task checkbox reads this to switch
// between its two roles: round "select" by default, square "mark done" while
// Option is down. One window-level listener feeds every subscribed checkbox, so
// only the checkboxes re-render on press/release — never the rows around them.
let altPressed = false;
const subscribers = new Set<() => void>();

function set(v: boolean) {
  if (v === altPressed) return;
  altPressed = v;
  for (const cb of subscribers) cb();
}

// Any key event carries the live modifier state, so syncing from `e.altKey`
// stays correct even if the raw Alt keyup is missed (e.g. a chord release).
const sync = (e: KeyboardEvent) => set(e.altKey);
const reset = () => set(false);

function subscribe(cb: () => void) {
  if (subscribers.size === 0) {
    // Capture phase so a focused input that stops propagation (e.g. the search
    // field) can't swallow the modifier state before we see it.
    window.addEventListener('keydown', sync, true);
    window.addEventListener('keyup', sync, true);
    // A blur (Cmd-Tab, focus lost mid-hold) never delivers the keyup.
    window.addEventListener('blur', reset);
  }
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) {
      window.removeEventListener('keydown', sync, true);
      window.removeEventListener('keyup', sync, true);
      window.removeEventListener('blur', reset);
    }
  };
}

export function useAltPressed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => altPressed,
    () => false
  );
}
