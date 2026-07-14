import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

/** Hide the mouse pointer when the bar opens (it lands right on the title field)
 *  and while typing, and bring it straight back on any real mouse movement — so
 *  it's only ever hidden mid-keystroke or freshly-opened, never while reaching
 *  for a control. Toggled via a class on <html> (imperatively, no re-render) so
 *  it stays snappy; mouse-move only ever *shows*, which killed the old hover lag. */
export function useCursorAutohide(): void {
  useEffect(() => {
    const root = document.documentElement;
    let hidden = false;
    let revealAt = 0;
    const hide = () => {
      if (!hidden) {
        hidden = true;
        root.classList.add('cursor-hidden');
      }
    };
    const show = () => {
      if (hidden) {
        hidden = false;
        root.classList.remove('cursor-hidden');
      }
    };
    const onMove = () => {
      // Ignore the settling mouse events macOS fires as the panel appears under a
      // stationary pointer; only a move after the grace reveals the cursor.
      if (performance.now() - revealAt < 250) return;
      show();
    };
    const reveal = () => {
      revealAt = performance.now();
      hide();
    };
    window.addEventListener('keydown', hide);
    window.addEventListener('mousemove', onMove, { passive: true });
    // Rust emits `mini-shown` on every reveal — hide until the mouse moves.
    const shown = listen('mini-shown', reveal);
    return () => {
      window.removeEventListener('keydown', hide);
      window.removeEventListener('mousemove', onMove);
      shown.then((un) => un());
      root.classList.remove('cursor-hidden');
    };
  }, []);
}
