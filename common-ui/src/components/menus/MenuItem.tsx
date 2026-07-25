import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export type MenuItemTone = 'default' | 'danger';

const TONE: Record<MenuItemTone, string> = {
  default:
    'text-content-1l dark:text-content-1d hover:bg-wash-2l dark:hover:bg-wash-2d',
  danger:
    'text-danger-500l dark:text-danger-500d hover:bg-danger-100l dark:hover:bg-danger-100d',
};

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: MenuItemTone;
  /** Persistent selected background (command-palette / sidebar current item). */
  active?: boolean;
  /** Rounded sidebar/nav style instead of a full-bleed menu row. */
  rounded?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** A row in a menu, command palette, or settings sidebar. */
export function MenuItem({
  tone = 'default',
  active,
  rounded = false,
  leading,
  trailing,
  className,
  type = 'button',
  children,
  ...rest
}: MenuItemProps) {
  return (
    <button
      type={type}
      className={cn(
        'flex w-full items-center gap-space-5 px-space-6 py-space-4 text-left text-[13px] disabled:pointer-events-none disabled:opacity-40',
        rounded && 'rounded-field',
        TONE[tone],
        active && 'bg-selection-1l dark:bg-selection-1d',
        className
      )}
      {...rest}
    >
      {leading && (
        <span
          className={cn(
            'grid shrink-0 place-items-center',
            tone === 'default' && 'text-content-3l dark:text-content-3d'
          )}
        >
          {leading}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing && (
        <span className="ml-auto shrink-0 text-content-3l dark:text-content-3d">{trailing}</span>
      )}
    </button>
  );
}
