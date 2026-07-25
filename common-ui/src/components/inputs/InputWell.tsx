import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export interface InputWellProps extends HTMLAttributes<HTMLDivElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** A recessed input container with focus-within ring and leading/trailing slots —
 *  wrap a `<TextInput bare>` (or any control) inside it. */
export function InputWell({
  leading,
  trailing,
  className,
  children,
  ...rest
}: InputWellProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-space-4 rounded-control bg-surface-0l dark:bg-surface-0d px-space-6 focus-within:ring-1 focus-within:ring-focus-1l dark:focus-within:ring-focus-1d',
        className
      )}
      {...rest}
    >
      {leading && (
        <span className="grid shrink-0 place-items-center text-content-3l dark:text-content-3d">
          {leading}
        </span>
      )}
      {children}
      {trailing && <span className="grid shrink-0 place-items-center">{trailing}</span>}
    </div>
  );
}
