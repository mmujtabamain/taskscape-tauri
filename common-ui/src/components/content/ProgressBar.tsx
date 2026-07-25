import type { HTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Completion fraction, 0…1. */
  value: number;
}

/** The stats-bar completion meter — recessed track + accent fill. */
export function ProgressBar({ value, className, ...rest }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cn(
        'relative h-1 w-24 overflow-hidden rounded-full bg-surface-0l dark:bg-surface-0d',
        className
      )}
      {...rest}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-accent-500l dark:bg-accent-500d"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
