import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';

export type IconButtonSize = 'sm' | 'md' | 'lg' | 'xl';
export type IconButtonVariant =
  | 'ghost'
  | 'ghostStrong'
  | 'plain'
  | 'accent'
  | 'danger'
  | 'onMedia';

const SIZE: Record<IconButtonSize, string> = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
  lg: 'h-7 w-7',
  xl: 'h-8 w-8',
};
const ICON_PX: Record<IconButtonSize, number> = { sm: 16, md: 18, lg: 18, xl: 20 };

const NEUTRAL = 'text-content-3l dark:text-content-3d';
const NEUTRAL_HOVER = 'hover:text-content-1l dark:hover:text-content-1d';

/** Each variant owns its own hover treatment — the well strength is a property
 *  of the variant, not a separate axis. `ghostStrong` exists because wash-1
 *  disappears on rows that already carry a wash (hovered rows, modal lists). */
const VARIANT: Record<IconButtonVariant, string> = {
  ghost: `${NEUTRAL} ${NEUTRAL_HOVER} hover:bg-wash-1l dark:hover:bg-wash-1d`,
  ghostStrong: `${NEUTRAL} ${NEUTRAL_HOVER} hover:bg-wash-2l dark:hover:bg-wash-2d`,
  plain: `${NEUTRAL} ${NEUTRAL_HOVER}`,
  accent:
    'text-accent-500l dark:text-accent-500d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-accent-600l dark:hover:text-accent-600d',
  danger: `${NEUTRAL} hover:bg-danger-100l dark:hover:bg-danger-100d hover:text-danger-500l dark:hover:text-danger-500d`,
  onMedia: 'text-white/70 hover:bg-white/15 hover:text-white',
};

const RADIUS = { field: 'rounded-field', control: 'rounded-control' } as const;

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  radius?: 'field' | 'control';
  filled?: boolean;
  iconWeight?: number;
  iconSize?: number;
  /** Toolbar-toggle resting state — forces the icon to the primary text tone. */
  active?: boolean;
}

/** The app's ubiquitous square ghost icon button. `className` still merges last,
 *  so reveal-on-hover callers pass their own `opacity-0 group-hover/x:opacity-100`. */
export function IconButton({
  icon,
  size = 'md',
  variant = 'ghost',
  radius = 'field',
  filled,
  iconWeight,
  iconSize,
  active,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'grid shrink-0 place-items-center disabled:pointer-events-none disabled:opacity-40',
        RADIUS[radius],
        SIZE[size],
        VARIANT[variant],
        active && 'text-content-1l dark:text-content-1d',
        className
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? ICON_PX[size]} filled={filled} weight={iconWeight} />
    </button>
  );
}
