import { cn } from '@taskscape/common-ui/cn';
import { IconButton } from '@taskscape/common-ui/components/buttons/IconButton';
import { Label } from '@taskscape/common-ui/components/typography/Label';
import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  label: string;
  /** Muted note shown between the label and the rule. */
  hint?: ReactNode;
  /** Extra content after the rule (e.g. a count). */
  trailing?: ReactNode;
  /** Shows a leading accent dot — the "this section has active state" marker. */
  active?: boolean;
  /** Renders a trailing clear button. */
  onClear?: () => void;
  clearTitle?: string;
  clearIcon?: string;
  className?: string;
}

/** The uppercase eyebrow + hairline rule used to head inspector/filter/settings
 *  sections. Consolidates the three ad-hoc re-implementations. */
export function SectionHeader({
  label,
  hint,
  trailing,
  active,
  onClear,
  clearTitle = 'Clear',
  clearIcon = 'close',
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('mb-space-5 gap-space-5 flex items-center', className)}>
      {active && (
        <span className="bg-accent-500l dark:bg-accent-500d h-1.5 w-1.5 shrink-0 rounded-full" />
      )}
      <Label
        tone="muted"
        weight="semibold"
        className="text-[10.5px] tracking-[0.12em] uppercase"
      >
        {label}
      </Label>
      {hint && (
        <Label tone="muted" className="text-[11px]">
          {hint}
        </Label>
      )}
      <span className="border-edge-1l dark:border-edge-1d flex-1 border-t" />
      {onClear && (
        <IconButton
          icon={clearIcon}
          size="sm"
          iconSize={13}
          variant="plain"
          onClick={onClear}
          title={clearTitle}
        />
      )}
      {trailing}
    </div>
  );
}
