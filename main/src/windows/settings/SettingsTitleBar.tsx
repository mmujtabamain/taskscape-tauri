import { Label } from '@taskscape/common-ui/components';
import type { ReactNode } from 'react';
import { WindowControls } from '../../components/WindowControls';
import { isMac } from '../../lib/platform';

// The window is frameless, so this draws the same chrome as the main window's
// TitleBar: real traffic lights on macOS, real buttons on Windows, and the bar
// itself as the drag region. Tauri matches the event target, so every element
// meant to drag carries the attribute.
//
// Settings is built with minimizable(false)/maximizable(false) (see build_panel),
// so those two controls are handed over as inert.
const OFF = ['minimize', 'fullscreen'] as const;

export interface SettingsTitleBarProps {
  /** Contextual actions, before the Windows buttons. */
  trailing?: ReactNode;
}

export function SettingsTitleBar({ trailing }: SettingsTitleBarProps) {
  return (
    <header
      data-tauri-drag-region
      className="border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d relative flex h-13 shrink-0 items-stretch border-b"
    >
      {isMac ? <WindowControls disabled={OFF} /> : <span className="w-3" />}

      <div
        data-tauri-drag-region
        className="px-space-6 flex min-w-0 flex-1 items-center"
      >
        <Label
          as="h1"
          data-tauri-drag-region
          tone="primary"
          weight="semibold"
          truncate
          className="font-display text-[13.5px]"
        >
          Settings
        </Label>
      </div>

      {trailing && (
        <div className="gap-space-4 pr-space-6 flex items-center">
          {trailing}
        </div>
      )}

      {!isMac && <WindowControls disabled={OFF} />}
    </header>
  );
}
