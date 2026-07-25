import { cn } from '@taskscape/common-ui/cn';
import { Label } from '@taskscape/common-ui/components/typography/Label';
import type { ReactNode } from 'react';

export type SettingRowLayout = 'inline' | 'stacked';

export interface SettingRowProps {
  title: ReactNode;
  /** One line on what the setting does, under the title. */
  description?: ReactNode;
  /** The control itself — a toggle, segmented picker, keycap, button. */
  control?: ReactNode;
  /** `stacked` drops the control onto its own full-width line, for controls too
   *  wide to sit beside the title (a three-up segmented picker). */
  layout?: SettingRowLayout;
  /** Note under the control — a validation error, or a hint that depends on the
   *  current value. */
  footnote?: ReactNode;
  className?: string;
}

/** One labelled setting inside a <SettingsGroup>. The root is a `group`, so a
 *  control can reveal itself on hover with `group-hover:opacity-100`. */
export function SettingRow({
  title,
  description,
  control,
  layout = 'inline',
  footnote,
  className,
}: SettingRowProps) {
  const text = (
    <div className="gap-space-1 flex min-w-0 flex-col">
      <Label tone="primary" className="text-[13px]">
        {title}
      </Label>
      {description && (
        <Label tone="muted" className="text-[11.5px]">
          {description}
        </Label>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        'group px-space-6 py-space-5 gap-space-4 flex flex-col',
        className
      )}
    >
      {layout === 'inline' ? (
        <div className="gap-space-7 flex items-center justify-between">
          {text}
          {control && <div className="shrink-0">{control}</div>}
        </div>
      ) : (
        <>
          {text}
          {control}
        </>
      )}
      {footnote}
    </div>
  );
}
