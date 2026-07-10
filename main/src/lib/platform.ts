export const isMac = navigator.userAgent.includes('Mac');
export const isWindows = navigator.userAgent.includes('Windows');

/** Display prefix for keyboard shortcuts ("⌘F" on macOS, "Ctrl+F" elsewhere). */
export const cmd = isMac ? '⌘' : 'Ctrl+';

/** True when the platform command modifier (⌘ / Ctrl) is held. */
export function cmdKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}
