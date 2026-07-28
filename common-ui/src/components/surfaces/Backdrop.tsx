import { cn } from '@taskscape/common-ui/cn';
import { forwardRef, type HTMLAttributes } from 'react';

/** `none` still absorbs presses — an invisible scrim is how a menu catches the
 *  click that dismisses it. */
export type BackdropDim = 'none' | 'soft' | 'strong';

/** Which named z-layer the scrim (and its content) sits on. Every overlay states
 *  its own, so stacking never depends on render order in App. */
export type OverlayLayer =
  | 'dropdown'
  | 'overlay'
  | 'modal'
  | 'menu'
  | 'tooltip';

const DIM: Record<BackdropDim, string> = {
  none: '',
  soft: 'bg-black/30',
  strong: 'bg-black/75',
};

const LAYER: Record<OverlayLayer, string> = {
  dropdown: 'z-dropdown',
  overlay: 'z-overlay',
  modal: 'z-modal',
  menu: 'z-menu',
  tooltip: 'z-tooltip',
};

export interface BackdropProps extends HTMLAttributes<HTMLDivElement> {
  dim?: BackdropDim;
  blur?: boolean;
  layer?: OverlayLayer;
}

/** The full-window scrim behind an overlay: dim, optional blur, and the z-layer
 *  the whole overlay rides on. Purely visual — the behaviour that goes with it
 *  (Escape, outside press, focus) lives in `<Overlay>`, which composes this. */
export const Backdrop = forwardRef<HTMLDivElement, BackdropProps>(
  function Backdrop(
    { dim = 'soft', blur = false, layer = 'modal', className, children, ...rest },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'fixed inset-0 outline-none',
          LAYER[layer],
          DIM[dim],
          dim !== 'none' && 'animate-scrim-in',
          blur && 'backdrop-blur-sm',
          className
        )}
        {...rest}
      >
        {children}
      </div>
    );
  }
);
