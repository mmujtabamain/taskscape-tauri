import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { isMac } from '../lib/platform';
import { Icon } from './Icon';

function useWindowFocused(): boolean {
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
const OUTER =
  'm42.7 85.4c23.6 0 42.7-19.1 42.7-42.7s-19.1-42.7-42.7-42.7-42.7 19.1-42.7 42.7 19.1 42.7 42.7 42.7z';
const INNER =
  'm42.7 81.8c21.6 0 39.1-17.5 39.1-39.1s-17.5-39.1-39.1-39.1-39.1 17.5-39.1 39.1 17.5 39.1 39.1 39.1z';

const GLYPHS: Record<string, React.ReactNode> = {
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

/** Custom-drawn traffic lights matching the native macOS geometry: red/yellow/
 *  green ring+disc that gray out when the window blurs, glyphs on group hover —
 *  no private API involved. */
function MacControls() {
  const focused = useWindowFocused();
  const win = getCurrentWindow();

  const lights: Array<{
    ring: string;
    fill: string;
    glyph: string;
    glyphColor: string;
    label: string;
    act: () => void;
  }> = [
    {
      ring: '#e24b41',
      fill: '#ed6a5f',
      glyph: 'close',
      glyphColor: '#460804',
      label: 'Close',
      act: () => void win.close(),
    },
    {
      ring: '#e1a73e',
      fill: '#f6be50',
      glyph: 'minimize',
      glyphColor: '#90591d',
      label: 'Minimize',
      act: () => void win.minimize(),
    },
    {
      ring: '#2dac2f',
      fill: '#61c555',
      glyph: 'fullscreen',
      glyphColor: '#2a6218',
      label: 'Full Screen',
      act: () => void win.isFullscreen().then((f) => win.setFullscreen(!f)),
    },
  ];

  return (
    <div className="group flex items-center gap-2 pr-3 pl-5" data-no-drag>
      {lights.map((l) => (
        <button
          key={l.label}
          onClick={l.act}
          title={l.label}
          className="block size-[13px]"
        >
          <svg
            viewBox="0 0 85.4 85.4"
            className="size-full"
            clipRule="evenodd"
            fillRule="evenodd"
          >
            <path
              d={OUTER}
              fill={focused ? l.ring : 'var(--tl-inactive-ring)'}
            />
            <path
              d={INNER}
              fill={focused ? l.fill : 'var(--tl-inactive-fill)'}
            />
            {focused && (
              <g
                fill={l.glyphColor}
                className="opacity-0 transition-opacity duration-100 group-hover:opacity-100"
              >
                {GLYPHS[l.glyph]}
              </g>
            )}
          </svg>
        </button>
      ))}
    </div>
  );
}

function WinControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    const sync = () => win.isMaximized().then(setMaximized);
    sync();
    let unlisten: (() => void) | undefined;
    win.onResized(sync).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [win]);

  const base =
    'flex h-full w-[46px] items-center justify-center text-content-2l dark:text-content-2d transition-colors duration-100';
  return (
    <div className="flex h-full items-stretch" data-no-drag>
      <button
        className={`${base} hover:bg-wash-2l dark:hover:bg-wash-2d`}
        onClick={() => win.minimize()}
        title="Minimize"
      >
        <Icon name="remove" size={20} />
      </button>
      <button
        className={`${base} hover:bg-wash-2l dark:hover:bg-wash-2d`}
        onClick={() => win.toggleMaximize()}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        <Icon name={maximized ? 'filter_none' : 'crop_square'} size={14} />
      </button>
      <button
        className={`${base} hover:bg-[#e81123] hover:text-white`}
        onClick={() => win.close()}
        title="Close"
      >
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

export function WindowControls() {
  return isMac ? <MacControls /> : <WinControls />;
}
