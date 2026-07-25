import type { ReactNode } from 'react';
import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import { Label } from '@taskscape/common-ui/components/typography/Label';

export interface EmptyStateProps {
  icon?: string;
  iconSize?: number;
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Centered icon + title + subtitle placeholder shared by the panes and panels. */
export function EmptyState({
  icon,
  iconSize = 30,
  title,
  subtitle,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-space-4 px-space-7 text-center',
        className
      )}
    >
      {icon && (
        <Icon name={icon} size={iconSize} className="text-content-3l dark:text-content-3d" />
      )}
      <Label as="div" tone="secondary" weight="medium" className="font-display text-[15px]">
        {title}
      </Label>
      {subtitle && (
        <Label as="div" tone="muted" className="text-[12.5px]">
          {subtitle}
        </Label>
      )}
      {children}
    </div>
  );
}
