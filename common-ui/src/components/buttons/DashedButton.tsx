import { cn } from '@taskscape/common-ui/cn';
import type { ButtonHTMLAttributes } from 'react';

export type DashedButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Dashed placeholder / dropzone button (empty "Add note", start-a-task,
 *  empty-attachment tiles). Caller sizes it via `className`. */
export function DashedButton({
  className,
  type = 'button',
  ...rest
}: DashedButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'gap-space-3 rounded-control border-edge-3l dark:border-edge-3d bg-surface-3l dark:bg-surface-3d text-content-3l dark:text-content-3d hover:border-content-3l dark:hover:border-content-3d hover:text-content-2l dark:hover:text-content-2d flex items-center justify-center border border-dashed disabled:pointer-events-none disabled:opacity-40',
        className
      )}
      {...rest}
    />
  );
}
