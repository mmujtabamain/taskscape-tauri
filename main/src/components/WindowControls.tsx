import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { isMac } from '../lib/platform';
import { GLYPHS, INNER, OUTER, useWindowFocused } from './windowChrome';

export type WindowControl = 'close' | 'minimize' | 'fullscreen';

export interface WindowControlsProps {
  /** Controls this window doesn't support. macOS draws them as inert gray discs
   *  (no glyph on hover), the way AppKit renders a utility window; Windows omits
   *  the buttons. The Settings window is neither minimizable nor maximizable. */
  disabled?: readonly WindowControl[];
}

/** Custom-drawn traffic lights matching the native macOS geometry: red/yellow/
 *  green ring+disc that gray out when the window blurs, glyphs on group hover —
 *  no private API involved. */
function MacControls({ disabled = [] }: WindowControlsProps) {
  const focused = useWindowFocused();
  const win = getCurrentWindow();

  const lights: Array<{
    id: WindowControl;
    ring: string;
    fill: string;
    glyph: string;
    glyphColor: string;
    label: string;
    act: () => void;
  }> = [
    {
      id: 'close',
      ring: '#e24b41',
      fill: '#ed6a5f',
      glyph: 'close',
      glyphColor: '#460804',
      label: 'Close',
      act: () => void win.close(),
    },
    {
      id: 'minimize',
      ring: '#e1a73e',
      fill: '#f6be50',
      glyph: 'minimize',
      glyphColor: '#90591d',
      label: 'Minimize',
      act: () => void win.minimize(),
    },
    {
      id: 'fullscreen',
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
      {lights.map((l) => {
        const inert = disabled.includes(l.id);
        const lit = focused && !inert;
        return (
          <button
            key={l.label}
            onClick={l.act}
            disabled={inert}
            title={l.label}
            className="block size-4"
          >
            <svg
              viewBox="0 0 85.4 85.4"
              className="size-full"
              clipRule="evenodd"
              fillRule="evenodd"
            >
              <path d={OUTER} fill={lit ? l.ring : 'var(--tl-inactive-ring)'} />
              <path d={INNER} fill={lit ? l.fill : 'var(--tl-inactive-fill)'} />
              {lit && (
                <g
                  fill={l.glyphColor}
                  transform="translate(42.7 42.7) scale(1.12) translate(-42.7 -42.7)"
                  className="opacity-0 group-hover:opacity-100"
                >
                  {GLYPHS[l.glyph]}
                </g>
              )}
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function WinControls({ disabled = [] }: WindowControlsProps) {
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
    'flex h-full w-[46px] items-center justify-center text-content-2l dark:text-content-2d';
  return (
    <div className="flex h-full items-stretch" data-no-drag>
      {!disabled.includes('minimize') && (
        <button
          className={cn(base, 'hover:bg-wash-2l dark:hover:bg-wash-2d')}
          onClick={() => win.minimize()}
          title="Minimize"
        >
          <Icon name="remove" size={20} />
        </button>
      )}
      {!disabled.includes('fullscreen') && (
        <button
          className={cn(base, 'hover:bg-wash-2l dark:hover:bg-wash-2d')}
          onClick={() => win.toggleMaximize()}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          <Icon name={maximized ? 'filter_none' : 'crop_square'} size={14} />
        </button>
      )}
      <button
        className={cn(base, 'hover:bg-[#e81123] hover:text-white')}
        onClick={() => win.close()}
        title="Close"
      >
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

export function WindowControls({ disabled }: WindowControlsProps = {}) {
  return isMac ? (
    <MacControls disabled={disabled} />
  ) : (
    <WinControls disabled={disabled} />
  );
}
