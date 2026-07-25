import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export type ButtonVariant = 'primary' | 'danger' | 'ghost';

const BASE =
  'inline-flex h-8 items-center justify-center rounded-control px-space-7 text-[12.5px] font-semibold tracking-[0.01em] transition-transform duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-1l dark:focus-visible:ring-focus-1d disabled:pointer-events-none disabled:opacity-40';
const VARIANT: Record<ButtonVariant, string> = {
  ghost:
    'border border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d text-content-1l dark:text-content-1d hover:border-edge-3l dark:hover:border-edge-3d hover:bg-surface-2l dark:hover:bg-surface-2d',
  primary:
    'bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift hover:bg-accent-600l dark:hover:bg-accent-600d active:bg-accent-700l dark:active:bg-accent-700d',
  danger:
    'bg-danger-500l dark:bg-danger-500d text-on-accent shadow-lift hover:bg-danger-600l dark:hover:bg-danger-600d',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/** Solid dialog / CTA button (promoted from Modal's BTN + BTN_VARIANT). */
export function Button({ variant = 'ghost', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cn(BASE, VARIANT[variant], className)} {...rest} />;
}
