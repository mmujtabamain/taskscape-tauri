// The preferences this window owns, and the one place that reads, coerces,
// persists and broadcasts them. Adding a setting means adding an entry to
// SETTING_DEFS — the load, the reset and the search index follow from it.
import { emit } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { setReducedMotion } from '../../lib/reducedMotion';
import { setTheme, type ThemePref } from '../../lib/theme';

interface SettingDef {
  /** Value used when the store holds nothing — or something unrecognized. */
  fallback: string;
  valid?: readonly string[];
  /** Replaces the plain `setSetting` write when the value needs side effects. */
  write?: (value: string) => Promise<void>;
  /** Broadcast `settings-changed` after writing. Only for values another window
   *  reads live: the main window filters its task list on `show_completed`,
   *  while Rust re-reads `screenshot_mode` per capture, so that one stays quiet
   *  rather than triggering a pointless reload. */
  notify?: boolean;
}

export const SETTING_DEFS = {
  theme: {
    fallback: 'system',
    valid: ['system', 'light', 'dark'],
    // setTheme applies the theme, persists it, and emits `theme-changed`.
    write: (value: string) => setTheme(value as ThemePref),
  },
  reduced_motion: {
    fallback: '0',
    valid: ['1', '0'],
    // Same shape as theme: reducedMotion.ts persists, applies the document class
    // and emits `reduced-motion-changed` for the other windows.
    write: (value: string) => setReducedMotion(value === '1'),
  },
  screenshot_mode: { fallback: 'fullscreen', valid: ['fullscreen', 'region'] },
  show_completed: { fallback: '1', valid: ['1', '0'], notify: true },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTING_DEFS;
export type SettingValues = Record<SettingKey, string>;

const KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

const defaults = (): SettingValues =>
  Object.fromEntries(
    KEYS.map((key) => [key, SETTING_DEFS[key].fallback])
  ) as SettingValues;

function coerce(key: SettingKey, stored: string | null): string {
  const def: SettingDef = SETTING_DEFS[key];
  if (stored === null) return def.fallback;
  return def.valid && !def.valid.includes(stored) ? def.fallback : stored;
}

export interface SettingsController {
  values: SettingValues;
  loaded: boolean;
  set: (key: SettingKey, value: string) => void;
  /** Every preference back to the value it shipped with. */
  resetAll: () => void;
  /** This key differs from what the window opened with. */
  changedSince: (key: SettingKey) => boolean;
  /** Any key does. */
  changed: boolean;
  /** Put the given keys back to what they were when the window opened. */
  discard: (...keys: SettingKey[]) => void;
  discardAll: () => void;
}

/** Read every preference once, then write through on change. */
export function useSettings(): SettingsController {
  const [values, setValues] = useState<SettingValues>(defaults);
  const [loaded, setLoaded] = useState(false);
  // What the window opened with — the baseline the soft reset restores. Every
  // change here is applied immediately, so "discard" means "undo this session",
  // not "don't save".
  const [opened, setOpened] = useState<SettingValues | null>(null);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const stored = await Promise.all(
        KEYS.map((key) => api.getSetting(key).catch(() => null))
      );
      if (stale) return;
      const loadedValues = Object.fromEntries(
        KEYS.map((key, i) => [key, coerce(key, stored[i])])
      ) as SettingValues;
      setValues(loadedValues);
      setOpened(loadedValues);
      setLoaded(true);
    })();
    return () => {
      stale = true;
    };
  }, []);

  const set = useCallback((key: SettingKey, value: string) => {
    setValues((prev) =>
      prev[key] === value ? prev : { ...prev, [key]: value }
    );
    const def: SettingDef = SETTING_DEFS[key];
    void (async () => {
      try {
        if (def.write) await def.write(value);
        else await api.setSetting(key, value);
        if (def.notify) await emit('settings-changed', { key, value });
      } catch {
        // The UI stays optimistic; the next open re-reads the stored truth.
      }
    })();
  }, []);

  const resetAll = useCallback(() => {
    for (const key of KEYS) set(key, SETTING_DEFS[key].fallback);
  }, [set]);

  const changedSince = useCallback(
    (key: SettingKey) => opened !== null && values[key] !== opened[key],
    [opened, values]
  );

  const discard = useCallback(
    (...keys: SettingKey[]) => {
      if (!opened) return;
      for (const key of keys)
        if (values[key] !== opened[key]) set(key, opened[key]);
    },
    [opened, values, set]
  );

  const discardAll = useCallback(() => discard(...KEYS), [discard]);

  return {
    values,
    loaded,
    set,
    resetAll,
    changedSince,
    changed: opened !== null && KEYS.some((k) => values[k] !== opened[k]),
    discard,
    discardAll,
  };
}
