import { cn } from '@taskscape/common-ui/cn';
import type { HTMLAttributes, ReactNode } from 'react';

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
        'gap-space-4 rounded-control bg-surface-0l dark:bg-surface-0d px-space-6 focus-within:ring-focus-1l dark:focus-within:ring-focus-1d flex items-center focus-within:ring-1',
        className
      )}
      {...rest}
    >
      {leading && (
        <span className="text-content-3l dark:text-content-3d grid shrink-0 place-items-center">
          {leading}
        </span>
      )}
      {children}
      {trailing && (
        <span className="grid shrink-0 place-items-center">{trailing}</span>
      )}
    </div>
  );
}
