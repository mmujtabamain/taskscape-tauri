import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { isMac } from '../lib/platform';
import { GLYPHS, INNER, OUTER, useWindowFocused } from './windowChrome';

export type WindowControl = 'close' | 'minimize' | 'fullscreen';

const ORDER: readonly WindowControl[] = ['close', 'minimize', 'fullscreen'];

const LIGHTS: Record<
  WindowControl,
  {
    ring: string;
    fill: string;
    glyph: string;
    glyphColor: string;
    label: string;
  }
> = {
  close: {
    ring: '#e24b41',
    fill: '#ed6a5f',
    glyph: 'close',
    glyphColor: '#460804',
    label: 'Close',
  },
  minimize: {
    ring: '#e1a73e',
    fill: '#f6be50',
    glyph: 'minimize',
    glyphColor: '#90591d',
    label: 'Minimize',
  },
  fullscreen: {
    ring: '#2dac2f',
    fill: '#61c555',
    glyph: 'fullscreen',
    glyphColor: '#2a6218',
    label: 'Full Screen',
  },
};

/** One macOS disc. Unlit — the window is blurred, or the control is `inert` —
 *  it's a gray ring+disc with no glyph on hover, the way AppKit renders a
 *  control a window doesn't support. Needs a `group` ancestor for the glyph. */
function Light({
  id,
  focused,
  inert = false,
  title,
  onClick,
}: {
  id: WindowControl;
  focused: boolean;
  inert?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const light = LIGHTS[id];
  const lit = focused && !inert;
  return (
    <button
      onClick={onClick}
      disabled={inert}
      title={title ?? light.label}
      className="block size-4"
    >
      <svg
        viewBox="0 0 85.4 85.4"
        className="size-full"
        clipRule="evenodd"
        fillRule="evenodd"
      >
        <path d={OUTER} fill={lit ? light.ring : 'var(--tl-inactive-ring)'} />
        <path d={INNER} fill={lit ? light.fill : 'var(--tl-inactive-fill)'} />
        {lit && (
          <g
            fill={light.glyphColor}
            transform="translate(42.7 42.7) scale(1.12) translate(-42.7 -42.7)"
            className="opacity-0 group-hover:opacity-100"
          >
            {GLYPHS[light.glyph]}
          </g>
        )}
      </svg>
    </button>
  );
}

/** The macOS cluster, red first. A control with no handler renders inert, which
 *  covers both a window that doesn't support it and a dialog that has nothing to
 *  minimize — the discs are there so the cluster reads as chrome either way. */
function MacLights({
  focused,
  act,
  closeTitle,
}: {
  focused: boolean;
  act: Partial<Record<WindowControl, () => void>>;
  closeTitle?: string;
}) {
  return (
    <div className="group flex items-center gap-2 pr-3 pl-5" data-no-drag>
      {ORDER.map((id) => (
        <Light
          key={id}
          id={id}
          focused={focused}
          inert={!act[id]}
          title={id === 'close' ? closeTitle : undefined}
          onClick={act[id]}
        />
      ))}
    </div>
  );
}

const WIN_BUTTON =
  'flex h-full w-[46px] items-center justify-center text-content-2l dark:text-content-2d';
const WIN_CLOSE = 'hover:bg-[#e81123] hover:text-white';

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

  const act: Partial<Record<WindowControl, () => void>> = {
    close: () => void win.close(),
    minimize: () => void win.minimize(),
    fullscreen: () =>
      void win.isFullscreen().then((f) => win.setFullscreen(!f)),
  };
  for (const id of disabled) delete act[id];

  return <MacLights focused={focused} act={act} />;
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

  return (
    <div className="flex h-full items-stretch" data-no-drag>
      {!disabled.includes('minimize') && (
        <button
          className={cn(WIN_BUTTON, 'hover:bg-wash-2l dark:hover:bg-wash-2d')}
          onClick={() => win.minimize()}
          title="Minimize"
        >
          <Icon name="remove" size={20} />
        </button>
      )}
      {!disabled.includes('fullscreen') && (
        <button
          className={cn(WIN_BUTTON, 'hover:bg-wash-2l dark:hover:bg-wash-2d')}
          onClick={() => win.toggleMaximize()}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          <Icon name={maximized ? 'filter_none' : 'crop_square'} size={14} />
        </button>
      )}
      <button
        className={cn(WIN_BUTTON, WIN_CLOSE)}
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

export interface DialogControlsProps {
  onClose: () => void;
  closeTitle?: string;
}

/** Chrome for something modal *inside* a window — a dialog or a panel. macOS
 *  gets the full cluster with only the red disc live: nothing behind it can be
 *  minimized or zoomed, but a lone dot reads as a status light rather than
 *  chrome. It dims with the window like the real thing. Windows draws its single
 *  close button. */
export function DialogControls({
  onClose,
  closeTitle = 'Close',
}: DialogControlsProps) {
  const focused = useWindowFocused();

  if (!isMac)
    return (
      <div className="flex h-full items-stretch" data-no-drag>
        <button
          className={cn(WIN_BUTTON, WIN_CLOSE)}
          onClick={onClose}
          title={closeTitle}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
    );

  return (
    <MacLights
      focused={focused}
      act={{ close: onClose }}
      closeTitle={closeTitle}
    />
  );
}
