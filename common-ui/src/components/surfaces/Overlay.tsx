import { cn } from '@taskscape/common-ui/cn';
import {
  Backdrop,
  type BackdropDim,
  type OverlayLayer,
} from '@taskscape/common-ui/components/surfaces/Backdrop';
import { useDismissable, useFocusTrap } from '@taskscape/common-ui/overlay';
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Where the panel sits inside the scrim. `fill` hands the whole window to the
 *  content (the lightbox); `anchored` positions nothing, for content that places
 *  itself at a coordinate (the context menu). */
export type OverlayPlacement = 'center' | 'top' | 'fill' | 'anchored';

const PLACEMENT: Record<OverlayPlacement, string> = {
  center: 'p-space-8 flex items-center justify-center',
  top: 'px-space-8 flex items-start justify-center pt-[12vh] pb-[8vh]',
  fill: 'flex flex-col',
  anchored: '',
};

export interface OverlayProps {
  dim?: BackdropDim;
  blur?: boolean;
  layer?: OverlayLayer;
  placement?: OverlayPlacement;
  /** Escape and a press on the scrim both call this. */
  onDismiss?: () => void;
  /** Own Escape in the capture phase, so the window's key map never sees the same
   *  press. On for anything that shares the window with the app's own shortcuts. */
  captureEscape?: boolean;
  /** Also dismiss on window blur/resize — for a menu pinned to a coordinate. */
  dismissOnWindowChange?: boolean;
  /** Keep Tab inside the overlay and hand focus back to the opener on close. On
   *  for blocking overlays; off for menus, whose trigger keeps focus. */
  trapFocus?: boolean;
  /** The press on the scrim that dismisses. `none` leaves outside presses to the
   *  content — for an overlay whose own body is the dismiss target, like a media
   *  viewer where the letterboxing around the image also closes it. */
  dismissOn?: 'mousedown' | 'click' | 'none';
  /** Right-press on the scrim. A menu uses it to swallow the OS context menu and
   *  close instead, so a right-click outside behaves like a left one. */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Extra classes for the scrim, e.g. a different pad or alignment. */
  className?: string;
  children: ReactNode;
}

/** The one foundation under every full-window overlay: scrim, placement, z-layer,
 *  the ways out (Escape, a press outside), focus containment, and a slot in the
 *  overlay-depth count so the app's key map defers while it's up.
 *
 *  It portals to `document.body`, so an overlay is never clipped or re-stacked by
 *  an ancestor and its position in the tree carries no meaning — `layer` is the
 *  whole story on stacking.
 *
 *  `children` become direct children of the scrim, which is what makes the
 *  placement classes above apply to them and lets a panel size itself against the
 *  window (`w-[min(26rem,100%)]`) rather than against a wrapper of unknown width. */
export function Overlay({
  dim = 'soft',
  blur = false,
  layer = 'modal',
  placement = 'center',
  onDismiss,
  captureEscape = false,
  dismissOnWindowChange = false,
  trapFocus = false,
  dismissOn = 'mousedown',
  onContextMenu,
  className,
  children,
}: OverlayProps) {
  const scrimRef = useRef<HTMLDivElement>(null);

  // The scrim absorbs outside presses itself, so the hook gets no ref — it only
  // wires Escape (and the window-change exit for menus).
  useDismissable({
    onDismiss,
    capture: captureEscape,
    onWindowChange: dismissOnWindowChange,
  });
  useFocusTrap(scrimRef, trapFocus && !!onDismiss);

  // Only a press that lands on the scrim itself dismisses: a press that starts on
  // the panel and drifts outward keeps the overlay open, and no panel has to
  // remember to stop propagation.
  const dismissFromScrim = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onDismiss?.();
  };
  const pressProps =
    onDismiss && dismissOn !== 'none'
      ? dismissOn === 'mousedown'
        ? { onMouseDown: dismissFromScrim }
        : { onClick: dismissFromScrim }
      : {};

  return createPortal(
    <Backdrop
      ref={scrimRef}
      dim={dim}
      blur={blur}
      layer={layer}
      tabIndex={trapFocus ? -1 : undefined}
      className={cn(PLACEMENT[placement], className)}
      onContextMenu={onContextMenu}
      {...pressProps}
    >
      {children}
    </Backdrop>,
    document.body
  );
}
