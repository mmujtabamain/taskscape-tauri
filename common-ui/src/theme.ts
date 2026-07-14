/** Toggle the `.dark` class the design tokens key their `dark:` variants off.
 *  The single source of the light/dark switch, shared by both apps' theme
 *  modules (which each resolve the effective `dark` value their own way). */
export function applyDark(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
}
