import { cn } from '@taskscape/common-ui/cn';
import { Label } from '@taskscape/common-ui/components/typography/Label';
import type { ReactNode } from 'react';

export type TitleBarBorder = 'edge-1' | 'edge-2' | 'none';
/** `1` paints the bar as window chrome; `inherit` lets the panel it sits on show
 *  through, so a dialog stays one continuous surface. */
export type TitleBarSurface = 1 | 'inherit';
/** Which edge `controls` sits on — macOS draws its chrome left, Windows right. */
export type TitleBarControlsSide = 'leading' | 'trailing';

const BORDER: Record<TitleBarBorder, string> = {
  'edge-1': 'border-b border-edge-1l dark:border-edge-1d',
  'edge-2': 'border-b border-edge-2l dark:border-edge-2d',
  none: '',
};

export interface TitleBarProps {
  title: ReactNode;
  /** Element the title renders as; a window's title is its `h1`. */
  titleAs?: 'h1' | 'h2' | 'div';
  /** Content between the controls and the title (icon, count badge). */
  leading?: ReactNode;
  /** Contextual actions, after the title. */
  trailing?: ReactNode;
  /** Window or dialog controls, drawn flush against `controlsSide`. */
  controls?: ReactNode;
  controlsSide?: TitleBarControlsSide;
  surface?: TitleBarSurface;
  /** Make the bar drag its frameless window. Tauri matches the event target, so
   *  every element meant to drag carries the attribute — the controls and the
   *  action slots deliberately don't. */
  draggable?: boolean;
  border?: TitleBarBorder;
  className?: string;
}

/** The chrome bar atop a frameless window, a dialog or a panel: platform
 *  controls, a display-face title, and room for contextual actions. */
export function TitleBar({
  title,
  titleAs = 'div',
  leading,
  trailing,
  controls,
  controlsSide = 'leading',
  surface = 1,
  draggable = false,
  border = 'edge-2',
  className,
}: TitleBarProps) {
  const drag = draggable || undefined;
  return (
    <header
      data-tauri-drag-region={drag}
      className={cn(
        'relative flex h-13 shrink-0 items-stretch',
        surface === 1 && 'bg-surface-1l dark:bg-surface-1d',
        BORDER[border],
        className
      )}
    >
      {/* With the controls on the far edge the title would otherwise hug the frame. */}
      {controlsSide === 'leading' ? controls : <span className="w-3" />}

      <div
        data-tauri-drag-region={drag}
        className="gap-space-4 px-space-6 flex min-w-0 flex-1 items-center"
      >
        {leading}
        <Label
          as={titleAs}
          data-tauri-drag-region={drag}
          tone="primary"
          weight="semibold"
          truncate
          className="font-display min-w-0 flex-1 text-[13.5px]"
        >
          {title}
        </Label>
      </div>

      {trailing && (
        <div className="gap-space-4 pr-space-6 flex items-center">
          {trailing}
        </div>
      )}

      {controlsSide === 'trailing' && controls}
    </header>
  );
}
