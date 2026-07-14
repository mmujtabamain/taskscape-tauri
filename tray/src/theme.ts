import { applyDark } from '@taskscape/common-ui/theme';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from './api';

// The tray has no theme UI of its own; it mirrors the main app's Appearance
// preference. The effective light/dark is resolved in Rust (the shared setting,
// else the system appearance) and applied by toggling the `.dark` class the
// design tokens key their `dark:` variant off (see common-ui/styles/tokens.css).

/** Re-resolve the effective theme and apply it. Called on startup, on every
 *  reveal, and when the OS appearance flips. */
export async function refreshTheme(): Promise<void> {
  applyDark(await api.getDark().catch(() => false));
}

export function initTheme(): void {
  void refreshTheme();
  // Re-resolve when the OS appearance flips (covers the 'system' preference).
  void getCurrentWindow().onThemeChanged(() => void refreshTheme());
}
