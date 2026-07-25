import type { HTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export type BadgeTone = 'muted' | 'outline' | 'accent' | 'danger' | 'recessed';
export type BadgeShape = 'field' | 'round';
export type BadgeSize = 'sm' | 'md' | 'lg';

const TONE: Record<BadgeTone, string> = {
  // muted carries a proper light-mode fill (fixes TaskRow's bg-surface-3d-only bug).
  muted:
    'border border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d text-content-3l dark:text-content-3d',
  outline:
    'border border-edge-2l dark:border-edge-2d text-content-3l dark:text-content-3d',
  accent: 'bg-accent-500l dark:bg-accent-500d text-on-accent',
  danger:
    'bg-danger-100l dark:bg-danger-100d text-danger-500l dark:text-danger-500d',
  recessed:
    'border border-edge-2l dark:border-edge-2d bg-surface-0l dark:bg-surface-0d text-content-2l dark:text-content-2d',
};
const SHAPE: Record<BadgeShape, string> = {
  field: 'rounded-field',
  round: 'rounded-full',
};
const SIZE: Record<BadgeSize, string> = {
  sm: 'h-5 px-space-3 text-[10.5px]',
  md: 'h-5 px-space-4 text-[11px]',
  lg: 'h-6 px-space-5 text-[11px]',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  shape?: BadgeShape;
  size?: BadgeSize;
}

/** Pills, tags, keycaps and count chips — one family, many tones. */
export function Badge({
  tone = 'muted',
  shape = 'field',
  size = 'md',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-space-1 font-semibold tabular-nums',
        SHAPE[shape],
        SIZE[size],
        TONE[tone],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
