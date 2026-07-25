import { cn } from '@taskscape/common-ui/cn';
import { Surface } from '@taskscape/common-ui/components/surfaces/Surface';
import { SectionHeader } from '@taskscape/common-ui/components/typography/SectionHeader';
import type { ReactNode } from 'react';

export interface SettingsGroupProps {
  label: string;
  /** Muted note beside the eyebrow. */
  hint?: ReactNode;
  /** Pass only when something in the group was changed since the window opened:
   *  it lights the header's dot — "changed, and discardable" — and turns it into
   *  the control that puts the group back. Restoring shipped defaults is a
   *  different, global action and doesn't live here. */
  onDiscard?: () => void;
  discardTitle?: string;
  className?: string;
  children: ReactNode;
}

/** An eyebrow-headed card of <SettingRow>s — the unit settings panes are built
 *  from. Rows are hairline-separated; the header carries the changed dot. */
export function SettingsGroup({
  label,
  hint,
  onDiscard,
  discardTitle = 'Discard changes made since this window opened',
  className,
  children,
}: SettingsGroupProps) {
  return (
    <section className={cn('gap-space-5 flex flex-col', className)}>
      <SectionHeader
        label={label}
        hint={hint}
        active={!!onDiscard}
        onClear={onDiscard}
        clearIcon="undo"
        clearTitle={discardTitle}
        className="mb-0"
      />
      <Surface className="divide-edge-1l dark:divide-edge-1d divide-y overflow-hidden">
        {children}
      </Surface>
    </section>
  );
}
