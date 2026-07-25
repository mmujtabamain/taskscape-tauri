import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export type SurfaceElevation = 'menu' | 'lift' | 'none';
export type SurfaceStep = 1 | 2 | 3;
export type SurfaceRadius = 'field' | 'control' | 'panel' | 'full';

const ELEVATION: Record<SurfaceElevation, string> = {
  menu: 'shadow-menu',
  lift: 'shadow-lift',
  none: '',
};
const SURFACE: Record<SurfaceStep, string> = {
  1: 'bg-surface-1l dark:bg-surface-1d',
  2: 'bg-surface-2l dark:bg-surface-2d',
  3: 'bg-surface-3l dark:bg-surface-3d',
};
const RADIUS: Record<SurfaceRadius, string> = {
  field: 'rounded-field',
  control: 'rounded-control',
  panel: 'rounded-panel',
  full: 'rounded-full',
};

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: SurfaceElevation;
  surface?: SurfaceStep;
  radius?: SurfaceRadius;
  border?: boolean;
}

/** A floating panel: menus, dropdowns, dialogs, toasts, popover chips. */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { elevation = 'none', surface = 3, radius = 'panel', border = true, className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        border && 'border border-edge-2l dark:border-edge-2d',
        SURFACE[surface],
        ELEVATION[elevation],
        RADIUS[radius],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
