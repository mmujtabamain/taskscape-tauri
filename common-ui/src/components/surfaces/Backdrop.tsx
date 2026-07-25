import type { HTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export type BackdropDim = '30' | '75';

const DIM: Record<BackdropDim, string> = {
  '30': 'bg-black/30',
  '75': 'bg-black/75',
};

export interface BackdropProps extends HTMLAttributes<HTMLDivElement> {
  dim?: BackdropDim;
  blur?: boolean;
}

/** Full-window scrim behind modals, the command palette and the lightbox.
 *  Layout of the centred content is passed via `className`.
 *
 *  Every scrim shares one z-layer: each is `fixed` and nothing between them and
 *  the root creates a stacking context, so two that coexist (a modal summoned
 *  from the lightbox) stack by DOM order — which is why `ModalHost` must stay
 *  last in App.tsx. */
export function Backdrop({ dim = '30', blur = false, className, children, ...rest }: BackdropProps) {
  return (
    <div
      className={cn('z-modal fixed inset-0', DIM[dim], blur && 'backdrop-blur-sm', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
