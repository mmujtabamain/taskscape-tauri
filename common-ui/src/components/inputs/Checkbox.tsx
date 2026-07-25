import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import type { ButtonHTMLAttributes } from 'react';

export type CheckboxShape = 'square' | 'round';
export type CheckboxSize = 'sm' | 'md';

const SHAPE: Record<CheckboxShape, string> = {
  square: 'rounded-field',
  round: 'rounded-full',
};
const SIZE: Record<CheckboxSize, string> = {
  sm: 'h-4.5 w-4.5',
  md: 'h-5 w-5',
};
const ICON_PX: Record<CheckboxSize, number> = { sm: 12, md: 14 };

export interface CheckboxProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  checked: boolean;
  shape?: CheckboxShape;
  size?: CheckboxSize;
}

/** The shared "done" checkbox recipe (square or round). The task-row gutter's
 *  dual-mode animated Check wraps this recipe rather than reusing the component. */
export function Checkbox({
  checked,
  shape = 'square',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: CheckboxProps) {
  return (
    <button
      type={type}
      role="checkbox"
      aria-checked={checked}
      className={cn(
        'grid shrink-0 place-items-center border-[1.5px]',
        SHAPE[shape],
        SIZE[size],
        checked
          ? 'bg-done-lamp-1l dark:bg-done-lamp-1d text-on-accent border-transparent'
          : 'border-edge-3l dark:border-edge-3d hover:border-content-3l dark:hover:border-content-3d',
        className
      )}
      {...rest}
    >
      {checked && <Icon name="check" size={ICON_PX[size]} weight={700} />}
    </button>
  );
}
