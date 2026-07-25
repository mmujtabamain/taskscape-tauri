import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export type LabelTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'accent'
  | 'danger'
  | 'onAccent'
  | 'inherit';
export type LabelWeight = 'normal' | 'medium' | 'semibold' | 'bold';

const TONE: Record<LabelTone, string> = {
  primary: 'text-content-1l dark:text-content-1d',
  secondary: 'text-content-2l dark:text-content-2d',
  muted: 'text-content-3l dark:text-content-3d',
  accent: 'text-accent-500l dark:text-accent-500d',
  danger: 'text-danger-500l dark:text-danger-500d',
  onAccent: 'text-on-accent',
  inherit: '',
};
const WEIGHT: Record<LabelWeight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

type LabelOwnProps<T extends ElementType> = {
  /** The element to render (defaults to `span`). */
  as?: T;
  tone?: LabelTone;
  weight?: LabelWeight;
  truncate?: boolean;
  className?: string;
  children?: ReactNode;
};

export type LabelProps<T extends ElementType = 'span'> = LabelOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof LabelOwnProps<T>>;

/** Text with a standardized foreground tone (the light/dark content-* pairs) and
 *  optional weight/truncation. Size and tracking stay per-use via `className`. */
export function Label<T extends ElementType = 'span'>({
  as,
  tone = 'inherit',
  weight,
  truncate,
  className,
  children,
  ...rest
}: LabelProps<T>) {
  const Tag = (as ?? 'span') as ElementType;
  return (
    <Tag
      className={cn(TONE[tone], weight && WEIGHT[weight], truncate && 'truncate', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
