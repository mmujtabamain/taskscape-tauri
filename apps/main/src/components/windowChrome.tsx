import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

/** Tracks whether this window currently holds focus — used to gray out the
 *  macOS traffic-light discs when the window blurs, matching native chrome. */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);
  return focused;
}

/* The macOS button geometry, traced from lwouis/macos-traffic-light-buttons-as-SVG:
   an outer ring + lighter inner disc, with the glyph revealed on hover. */
export const OUTER =
  'm42.7 85.4c23.6 0 42.7-19.1 42.7-42.7s-19.1-42.7-42.7-42.7-42.7 19.1-42.7 42.7 19.1 42.7 42.7 42.7z';
export const INNER =
  'm42.7 81.8c21.6 0 39.1-17.5 39.1-39.1s-17.5-39.1-39.1-39.1-39.1 17.5-39.1 39.1 17.5 39.1 39.1 39.1z';

export const GLYPHS: Record<string, React.ReactNode> = {
  close: (
    <>
      <path d="m22.5 57.8 35.3-35.3c1.4-1.4 3.6-1.4 5 0l.1.1c1.4 1.4 1.4 3.6 0 5l-35.3 35.3c-1.4 1.4-3.6 1.4-5 0l-.1-.1c-1.3-1.4-1.3-3.6 0-5z" />
      <path d="m27.6 22.5 35.3 35.3c1.4 1.4 1.4 3.6 0 5l-.1.1c-1.4 1.4-3.6 1.4-5 0l-35.3-35.3c-1.4-1.4-1.4-3.6 0-5l.1-.1c1.4-1.3 3.6-1.3 5 0z" />
    </>
  ),
  minimize: (
    <path d="m17.8 39.1h49.9c1.9 0 3.5 1.6 3.5 3.5v.1c0 1.9-1.6 3.5-3.5 3.5h-49.9c-1.9 0-3.5-1.6-3.5-3.5v-.1c0-1.9 1.5-3.5 3.5-3.5z" />
  ),
  fullscreen: (
    <>
      <path d="m31.2 20.8h26.7c3.6 0 6.5 2.9 6.5 6.5v26.7z" />
      <path d="m54.4 64.5h-26.8c-3.6 0-6.5-2.9-6.5-6.5v-26.8z" />
    </>
  ),
};
