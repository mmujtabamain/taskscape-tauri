import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ToolbarButtonSize = 'xs' | 'sm' | 'md' | 'lg';
/** `ghost`/`accent`/`danger` share IconButton's vocabulary — same names, same
 *  hover treatments. `well` is this component's own. */
export type ToolbarButtonVariant = 'ghost' | 'well' | 'accent' | 'danger';

const SIZE: Record<ToolbarButtonSize, string> = {
  // Height-less and tighter than the rest: the mini capture bar sizes its rows
  // itself, so this one is padding-only.
  xs: 'gap-1.5 rounded-control px-2 py-1 text-xs font-normal',
  sm: 'h-6 px-space-4 text-[12px]',
  md: 'h-7 px-space-5 text-[12px]',
  lg: 'h-8 px-space-5 text-[12px]',
};
const VARIANT: Record<ToolbarButtonVariant, string> = {
  ghost:
    'text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d',
  // A solid-surface fill rather than ghost's translucent wash, for buttons on a
  // surface a wash would disappear against. Text tone is the caller's — `well`'s
  // users color by state (idle / attached / failed), so a resting or hover tone
  // here would fight them.
  well: 'hover:bg-surface-1l dark:hover:bg-surface-1d disabled:cursor-default disabled:hover:bg-transparent',
  accent:
    'text-accent-500l dark:text-accent-500d hover:bg-wash-1l dark:hover:bg-wash-1d',
  danger:
    'text-content-3l dark:text-content-3d hover:bg-danger-100l dark:hover:bg-danger-100d hover:text-danger-500l dark:hover:text-danger-500d',
};

export interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: string;
  filled?: boolean;
  iconSize?: number;
  iconWeight?: number;
  size?: ToolbarButtonSize;
  variant?: ToolbarButtonVariant;
  children?: ReactNode;
}

/** Icon+label text button used in toolbars, footers, bulk bars and empty-state
 *  affordances (Shot/Link/File, Restore all, Undo, Add note, …). */
export function ToolbarButton({
  icon,
  filled,
  iconSize = 15,
  iconWeight,
  size = 'md',
  variant = 'ghost',
  className,
  type = 'button',
  children,
  ...rest
}: ToolbarButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'gap-space-3 rounded-field flex items-center font-semibold disabled:pointer-events-none disabled:opacity-40',
        SIZE[size],
        VARIANT[variant],
        className
      )}
      {...rest}
    >
      {icon && (
        <Icon name={icon} size={iconSize} weight={iconWeight} filled={filled} />
      )}
      {children}
    </button>
  );
}
