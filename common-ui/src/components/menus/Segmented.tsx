import type { ReactNode } from 'react';
import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';

export type SegmentedVariant = 'accentThumb' | 'surfaceThumb';

const THUMB: Record<SegmentedVariant, { active: string; inactive: string }> = {
  accentThumb: {
    active: 'bg-accent-500l dark:bg-accent-500d text-on-accent shadow-lift',
    inactive:
      'text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d',
  },
  surfaceThumb: {
    active:
      'border border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d text-content-1l dark:text-content-1d',
    inactive:
      'text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d',
  },
};

export interface SegmentedItem<T> {
  value: T;
  label?: ReactNode;
  icon?: string;
  title?: string;
}

export type SegmentedSize = 'sm' | 'md';

const SIZE: Record<SegmentedSize, string> = {
  sm: 'h-5.5 px-space-3 text-[11px]',
  md: 'h-6.5 px-space-4 text-[12px]',
};

export interface SegmentedProps<T extends string | number> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: SegmentedVariant;
  size?: SegmentedSize;
  className?: string;
}

/** A recessed segmented control — one unified component for both the accent-thumb
 *  (filter) and surface-thumb (settings) styles. */
export function Segmented<T extends string | number>({
  items,
  value,
  onChange,
  variant = 'accentThumb',
  size = 'md',
  className,
}: SegmentedProps<T>) {
  return (
    <div
      className={cn(
        'grid auto-cols-fr grid-flow-col gap-space-1 rounded-field bg-surface-0l dark:bg-surface-0d p-space-1',
        className
      )}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={String(it.value)}
            type="button"
            title={it.title}
            onClick={() => onChange(it.value)}
            className={cn(
              'flex items-center justify-center gap-space-2 truncate rounded-field font-semibold',
              SIZE[size],
              active ? THUMB[variant].active : THUMB[variant].inactive
            )}
          >
            {it.icon && <Icon name={it.icon} size={15} />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
