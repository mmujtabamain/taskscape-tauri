// Tracks transient popovers (context menu, project dropdown) that live inside
// the main window, so window-level key handlers can defer to them — e.g. an
// Escape that only dismisses a menu shouldn't also clear the task selection.
let depth = 0;

export const overlayOpen = () => depth > 0;

export function setOverlay(open: boolean) {
  depth = Math.max(0, depth + (open ? 1 : -1));
}
