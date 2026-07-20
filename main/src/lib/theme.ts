import { applyDark } from '@taskscape/common-ui/theme';
import { emit, listen } from '@tauri-apps/api/event';
import { api } from '../api';

export type ThemePref = 'system' | 'light' | 'dark';

const media = window.matchMedia('(prefers-color-scheme: dark)');
let pref: ThemePref = 'system';

function apply() {
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  applyDark(dark);
  document.documentElement.style.colorScheme =
    pref === 'system' ? 'light dark' : pref;
  // Cache the preference for index.html's pre-paint theme script, so the next
  // launch resolves a forced theme before its first frame.
  try {
    localStorage.setItem('theme', pref);
  } catch {
    // Private-mode/storage failures only cost the pre-paint hint.
  }
  // Keep the native window background matched (main window only; the command
  // no-ops for panels), so a resize never flashes a stale-theme edge.
  api.setWindowTheme(dark).catch(() => {});
}

/** Resolve the saved preference, apply it, and follow live changes
 *  (system appearance flips + `theme-changed` from other windows). */
export async function initTheme(): Promise<ThemePref> {
  const saved = await api.getSetting('theme').catch(() => null);
  if (saved === 'light' || saved === 'dark' || saved === 'system') pref = saved;
  apply();
  media.addEventListener('change', apply);
  listen<ThemePref>('theme-changed', (e) => {
    pref = e.payload;
    apply();
  });
  return pref;
}

export function themePref(): ThemePref {
  return pref;
}

export async function setTheme(next: ThemePref) {
  pref = next;
  apply();
  await api.setSetting('theme', next);
  await emit('theme-changed', next);
}
