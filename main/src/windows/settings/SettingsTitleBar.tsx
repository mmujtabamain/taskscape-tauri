import { TitleBar } from '@taskscape/common-ui/components';
import type { ReactNode } from 'react';
import { WindowControls } from '../../components/WindowControls';
import { controlsSide } from '../../components/windowChrome';

// The window is frameless, so the shared TitleBar draws the same chrome as the
// main window's: real traffic lights on macOS, real buttons on Windows, and the
// bar itself as the drag region.
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
    <TitleBar
      draggable
      title="Settings"
      titleAs="h1"
      trailing={trailing}
      controls={<WindowControls disabled={OFF} />}
      controlsSide={controlsSide}
    />
  );
}
