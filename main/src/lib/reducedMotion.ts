import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { api } from '../api';

// Low Power Mode → reduced motion. macOS Low Power Mode isn't exposed to the
// webview (unlike the "Reduce Motion" accessibility setting, which the CSS
// `prefers-reduced-motion` block already honors), so Rust reads it and streams
// changes as `power-state-changed` events. Here we mirror `theme.ts`: hold the
// state, toggle a document-level class (its CSS twin of the reduced-motion
// media block lives in common-ui/styles/tokens.css), and expose it to React.

let lowPower = false;
const listeners = new Set<() => void>();

function setLowPower(next: boolean) {
  if (next === lowPower) return;
  lowPower = next;
  document.documentElement.classList.toggle('reduced-motion', next);
  for (const l of listeners) l();
}

/** Read the initial Low Power Mode state and follow live changes. Call once at
 *  startup (from main.tsx, alongside initTheme). No-op-safe off macOS. */
export async function initReducedMotion(): Promise<void> {
  void listen<boolean>('power-state-changed', (e) => setLowPower(e.payload));
  try {
    setLowPower(await api.isLowPowerMode());
  } catch {
    // Command unavailable (non-macOS): stay unreduced.
  }
}

/** Subscribe to Low Power Mode from React. */
export function useLowPowerMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lowPower
  );
}
