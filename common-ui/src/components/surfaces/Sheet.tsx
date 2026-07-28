import { cn } from '@taskscape/common-ui/cn';
import { KeyAction } from '@taskscape/common-ui/components/buttons/KeyAction';
import { Overlay } from '@taskscape/common-ui/components/surfaces/Overlay';
import { Surface } from '@taskscape/common-ui/components/surfaces/Surface';
import { Label } from '@taskscape/common-ui/components/typography/Label';
import { Icon } from '@taskscape/common-ui/Icon';
import { useId, type ReactNode } from 'react';

/** `accent` for anything undoable, `danger` for anything that isn't. The tone
 *  paints the badge and the accept button, so reversibility is legible before the
 *  copy is read. */
export type SheetTone = 'accent' | 'danger';

/** A soft tinted fill, not a solid one: the badge should register as intent, not
 *  compete with the accept button for the eye. */
const BADGE: Record<SheetTone, string> = {
  accent:
    'bg-selection-1l dark:bg-selection-1d text-accent-500l dark:text-accent-500d',
  danger:
    'bg-danger-100l dark:bg-danger-100d text-danger-500l dark:text-danger-500d',
};

export interface SheetProps {
  /** Material Symbols glyph for the badge. Without one the text starts flush. */
  glyph?: string;
  tone?: SheetTone;
  /** What's happening, in a few words. Wraps rather than truncates — a name in
   *  the question is worth more than a single-line guarantee. */
  headline: ReactNode;
  /** The consequence, under the headline. */
  detail?: ReactNode;
  /** The thing being acted on — a field. Sits below the text block, full width. */
  children?: ReactNode;
  /** The ⏎ action. */
  accept: ReactNode;
  /** A third way out, in the action row's left corner. */
  instead?: ReactNode;
  onDismiss: () => void;
  className?: string;
}

/** The app's one question surface: a single card, centered, that states what is
 *  about to happen and offers exactly one way forward.
 *
 *  It's one continuous surface rather than stacked bands — a tinted badge carries
 *  the intent, the text block carries the question, and a lone hairline separates
 *  the action row. The two ways out are plain, equally sized buttons: ⏎ and esc
 *  both work, but neither is annotated — the row stays quiet. */
export function Sheet({
  glyph,
  tone = 'accent',
  headline,
  detail,
  children,
  accept,
  instead,
  onDismiss,
  className,
}: SheetProps) {
  const headlineId = useId();
  const detailId = useId();

  return (
    <Overlay
      layer="modal"
      placement="center"
      onDismiss={onDismiss}
      captureEscape
      trapFocus
    >
      <Surface
        role="dialog"
        aria-modal
        aria-labelledby={headlineId}
        aria-describedby={detail ? detailId : undefined}
        elevation="menu"
        surface={2}
        radius="panel"
        className={cn(
          'animate-sheet-in w-[min(26rem,100%)] overflow-hidden',
          className
        )}
      >
        <div className="p-space-6">
          {/* Badge and headline share one centered row, so the glyph lines up with
              the words whether or not a detail follows. The detail then runs the
              card's full width instead of being indented into a narrow column
              beside the badge — fewer ragged wraps, and nothing to mis-align. */}
          <div className="gap-space-6 flex items-center">
            {glyph && (
              <span
                aria-hidden
                className={cn(
                  'rounded-control grid size-8 shrink-0 place-items-center',
                  BADGE[tone]
                )}
              >
                <Icon name={glyph} size={18} />
              </span>
            )}
            <Label
              as="h2"
              id={headlineId}
              tone="primary"
              weight="semibold"
              className="font-display min-w-0 flex-1 text-[15px] leading-5 text-pretty"
            >
              {headline}
            </Label>
          </div>

          {detail && (
            <Label
              as="p"
              id={detailId}
              tone="secondary"
              className="mt-space-6 text-[12.5px] leading-normal text-pretty"
            >
              {detail}
            </Label>
          )}

          {children && <div className="mt-space-7 min-w-0">{children}</div>}
        </div>

        <div className="border-edge-1l dark:border-edge-1d gap-space-5 px-space-6 pt-space-6 pb-space-6 flex items-center border-t">
          {instead}
          <div className="gap-space-4 ml-auto grid shrink-0 grid-cols-2 [&>button]:min-w-24">
            <KeyAction label="Cancel" onClick={onDismiss} />
            {accept}
          </div>
        </div>
      </Surface>
    </Overlay>
  );
}
