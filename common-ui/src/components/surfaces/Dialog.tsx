import { cn } from '@taskscape/common-ui/cn';
import { Backdrop } from '@taskscape/common-ui/components/surfaces/Backdrop';
import { Surface } from '@taskscape/common-ui/components/surfaces/Surface';
import { Label } from '@taskscape/common-ui/components/typography/Label';
import { Icon } from '@taskscape/common-ui/Icon';
import { useId, type ReactNode } from 'react';

export type DialogTone = 'default' | 'danger';

// The badge is the dialog's one splash of color, and it carries the whole tone:
// a soft tinted square that says at a glance whether this is routine or
// destructive, so the copy doesn't have to shout it.
const BADGE: Record<DialogTone, string> = {
  default:
    'bg-selection-1l dark:bg-selection-1d text-accent-500l dark:text-accent-500d',
  danger:
    'bg-danger-100l dark:bg-danger-100d text-danger-500l dark:text-danger-500d',
};

export interface DialogProps {
  /** Material Symbols glyph for the tone badge; omitted, the dialog opens on its
   *  title. */
  icon?: string;
  tone?: DialogTone;
  title: ReactNode;
  message?: ReactNode;
  /** Fields, on the same gutter as the title. */
  children?: ReactNode;
  /** Buttons, flush right, default last. */
  actions?: ReactNode;
  /** Buttons that aren't part of the accept/cancel pair, flush left in the same
   *  row — the slot macOS gives a third way out ("Don't Save"). */
  altActions?: ReactNode;
  /** Dismissed by the scrim. Escape and the buttons are the caller's business. */
  onDismiss?: () => void;
  className?: string;
}

/** A centered alert sheet: tone badge, title, optional message, whatever fields
 *  the caller passes, and one action row.
 *
 *  The layout is one column, one gutter. Every region — header, message, fields,
 *  buttons — starts and ends on the same `space-8` inset, spaced by a single
 *  `space-7` gap, so nothing is indented under anything else. The badge is the
 *  one exception: it shares the title's row rather than owning one, because a
 *  lone chip on its own line reads as a stray part instead of a heading. */
export function Dialog({
  icon,
  tone = 'default',
  title,
  message,
  children,
  actions,
  altActions,
  onDismiss,
  className,
}: DialogProps) {
  const titleId = useId();
  const messageId = useId();

  return (
    <Backdrop
      dim="30"
      className="flex items-center justify-center"
      onMouseDown={onDismiss}
    >
      <Surface
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        elevation="menu"
        surface={2}
        radius="panel"
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'animate-scale-in w-[min(420px,92vw)] overflow-hidden',
          className
        )}
      >
        <div className="gap-space-7 p-space-8 flex max-h-[70vh] flex-col overflow-y-auto">
          <div className="gap-space-6 flex items-center">
            {icon && (
              <div
                className={cn(
                  'rounded-field grid size-7 shrink-0 place-items-center',
                  BADGE[tone]
                )}
              >
                <Icon name={icon} size={16} />
              </div>
            )}
            <Label
              as="h2"
              id={titleId}
              tone="primary"
              weight="semibold"
              className="font-display min-w-0 text-[15px] tracking-[-0.01em] text-balance"
            >
              {title}
            </Label>
          </div>

          {message && (
            <Label
              as="p"
              id={messageId}
              tone="secondary"
              className="text-[13px] leading-5 font-[450] text-pretty"
            >
              {message}
            </Label>
          )}

          {children}
        </div>

        {(actions || altActions) && (
          <div className="border-edge-2l dark:border-edge-2d bg-surface-1l dark:bg-surface-1d gap-space-5 px-space-8 py-space-6 flex items-center border-t">
            {altActions}
            <div className="gap-space-5 ml-auto flex items-center">
              {actions}
            </div>
          </div>
        )}
      </Surface>
    </Backdrop>
  );
}
