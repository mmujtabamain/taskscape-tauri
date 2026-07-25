import { emit, listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { api } from '../api';

// Reduced motion has two sources, mirrored here the way `theme.ts` mirrors the
// theme: the user's own switch (persisted as `reduced_motion`, flipped from
// Settings and broadcast as `reduced-motion-changed`), and macOS Low Power Mode,
// which isn't exposed to the webview — Rust reads it and streams changes as
// `power-state-changed`. Either one on means motion is reduced, so we toggle the
// document-level class whose CSS twin lives in common-ui/styles/tokens.css.
//
// The third source — the system's own "Reduce Motion" accessibility setting —
// needs nothing from us: the `prefers-reduced-motion` block in tokens.css already
// honors it. It is deliberately NOT part of this module's state, so anything that
// reports motion status back to the user has to read that media query too.

let pref = false;
let lowPower = false;
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.classList.toggle('reduced-motion', pref || lowPower);
  for (const l of listeners) l();
}

function setLowPower(next: boolean) {
  if (next === lowPower) return;
  lowPower = next;
  apply();
}

function setPref(next: boolean) {
  if (next === pref) return;
  pref = next;
  apply();
}

/** Read the stored preference and the initial Low Power Mode state, apply both,
 *  and follow live changes. Call once at startup (from main.tsx / panels.tsx,
 *  alongside initTheme). No-op-safe off macOS. */
export async function initReducedMotion(): Promise<void> {
  void listen<boolean>('power-state-changed', (e) => setLowPower(e.payload));
  void listen<boolean>('reduced-motion-changed', (e) => setPref(e.payload));
  pref = (await api.getSetting('reduced_motion').catch(() => null)) === '1';
  try {
    lowPower = await api.isLowPowerMode();
  } catch {
    // Command unavailable (non-macOS): Low Power Mode stays off.
  }
  apply();
}

/** Persist the user's switch, apply it here, and tell the other windows. */
export async function setReducedMotion(next: boolean): Promise<void> {
  setPref(next);
  await api.setSetting('reduced_motion', next ? '1' : '0');
  await emit('reduced-motion-changed', next);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Whether macOS is in Low Power Mode right now (always false off macOS). */
export function useLowPowerMode(): boolean {
  return useSyncExternalStore(subscribe, () => lowPower);
}

/** Whether motion is reduced by us — the user's switch or Low Power Mode. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => pref || lowPower);
}
