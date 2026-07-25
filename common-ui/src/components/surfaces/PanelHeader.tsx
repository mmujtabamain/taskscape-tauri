import type { ReactNode } from 'react';
import { cn } from '@taskscape/common-ui/cn';
import { IconButton } from '@taskscape/common-ui/components/buttons/IconButton';
import { Label } from '@taskscape/common-ui/components/typography/Label';

export type PanelHeaderBorder = 'edge-1' | 'edge-2' | 'none';

const BORDER: Record<PanelHeaderBorder, string> = {
  'edge-1': 'border-b border-edge-1l dark:border-edge-1d',
  'edge-2': 'border-b border-edge-2l dark:border-edge-2d',
  none: '',
};

export interface PanelHeaderProps {
  title: ReactNode;
  onClose?: () => void;
  closeTitle?: string;
  /** Content before the title (icon, count badge). */
  leading?: ReactNode;
  /** Actions between the title and the close button. */
  trailing?: ReactNode;
  border?: PanelHeaderBorder;
  className?: string;
}

/** The h-11 title bar atop dialogs, panels and side sheets. */
export function PanelHeader({
  title,
  onClose,
  closeTitle = 'Close',
  leading,
  trailing,
  border = 'edge-1',
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        'flex h-11 shrink-0 items-center gap-space-4 px-space-6',
        BORDER[border],
        className
      )}
    >
      {leading}
      <Label
        as="div"
        tone="primary"
        weight="semibold"
        truncate
        className="min-w-0 flex-1 font-display text-[13.5px]"
      >
        {title}
      </Label>
      {(trailing || onClose) && (
        <div className="flex items-center gap-space-3">
          {trailing}
          {onClose && (
            <IconButton icon="close" size="md" onClick={onClose} title={closeTitle} />
          )}
        </div>
      )}
    </div>
  );
}
