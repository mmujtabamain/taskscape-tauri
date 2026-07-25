import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export interface KeycapProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Actively capturing a new key combo — lights the accent border/text. */
  recording?: boolean;
}

/** A clickable keycap that records a shortcut: recessed field with a keyboard
 *  glyph, accent-lit while recording. */
export function Keycap({ recording = false, className, type = 'button', ...rest }: KeycapProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-6 min-w-14 items-center justify-center rounded-field border px-space-5 font-sans text-[11px] tabular-nums',
        recording
          ? 'border-accent-500l dark:border-accent-500d bg-surface-0l dark:bg-surface-0d text-accent-500l dark:text-accent-500d'
          : 'border-edge-2l dark:border-edge-2d bg-surface-0l dark:bg-surface-0d text-content-2l dark:text-content-2d hover:border-edge-3l dark:hover:border-edge-3d hover:text-content-1l dark:hover:text-content-1d',
        className
      )}
      {...rest}
    />
  );
}
