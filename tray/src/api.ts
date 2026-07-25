import type { HotkeyBinding } from '@taskscape/common-ui/hotkeys';
import { invoke } from '@tauri-apps/api/core';

export interface CaptureTarget {
  project: string;
  list: string;
}

export const api = {
  hideMini: () => invoke<void>('hide_mini'),
  listHotkeys: () => invoke<HotkeyBinding[]>('list_hotkeys'),
  // Whether the mini bar should render dark, resolved in Rust from the app's
  // Appearance setting (else the system appearance), so it matches the main app.
  getDark: () => invoke<boolean>('get_dark'),
  captureTarget: () => invoke<CaptureTarget>('capture_target'),
  openMain: () => invoke<void>('open_main'),
  // Fire-and-forget: the capture runs in the background and reports progress via
  // the `screenshot-pending` / `screenshot-captured` / `screenshot-error` events.
  captureAndAttach: () => invoke<void>('capture_and_attach'),
  submitCapture: (args: {
    title: string;
    notes?: string | null;
    screenshotPaths?: string[];
  }) =>
    invoke<void>('submit_capture', {
      title: args.title,
      notes: args.notes ?? null,
      screenshotPaths: args.screenshotPaths ?? [],
    }),
};
