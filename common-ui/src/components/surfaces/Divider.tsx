import { cn } from '@taskscape/common-ui/cn';
import type { HTMLAttributes } from 'react';

export type DividerLevel = 1 | 2 | 3;

const BORDER: Record<DividerLevel, string> = {
  1: 'border-edge-1l dark:border-edge-1d',
  2: 'border-edge-2l dark:border-edge-2d',
  3: 'border-edge-3l dark:border-edge-3d',
};
const BG: Record<DividerLevel, string> = {
  1: 'bg-edge-1l dark:bg-edge-1d',
  2: 'bg-edge-2l dark:bg-edge-2d',
  3: 'bg-edge-3l dark:bg-edge-3d',
};

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  level?: DividerLevel;
}

/** A hairline rule — horizontal `border-t` or a vertical `w-px` fill. Callers set
 *  length/margins via `className` (e.g. `h-4`, `mx-2 my-1`). */
export function Divider({
  orientation = 'horizontal',
  level = 2,
  className,
  ...rest
}: DividerProps) {
  if (orientation === 'vertical') {
    return (
      <div
        className={cn('w-px self-stretch', BG[level], className)}
        {...rest}
      />
    );
  }
  return <div className={cn('border-t', BORDER[level], className)} {...rest} />;
}
