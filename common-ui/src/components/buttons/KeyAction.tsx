import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import type { ButtonHTMLAttributes } from 'react';

export type KeyActionVariant = 'accept' | 'danger' | 'quiet';

const BASE =
  'gap-space-4 rounded-control inline-flex shrink-0 items-center justify-center text-[12.5px] font-semibold tracking-[0.01em] transition-transform duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-1l dark:focus-visible:ring-focus-1d disabled:pointer-events-none disabled:opacity-40';

// One anatomy for all three: a fill, plus the *same* edge over it. The sameness
// is the point. Two buttons only read as equal size when their colour starts at
// the same distance from the boundary, and `edge-2` is a translucent wash rather
// than an opaque colour — it shifts whatever it covers by an identical amount, so
// the accent button and the recessed one end up inset alike. Give one an opaque
// hue step and the other a wash and they will never agree, however carefully the
// step is picked; that mismatch, not the box model, is what makes a solid button
// look bigger than its neighbour. No drop shadow either: on an already-raised
// panel it only bleeds past the button, reading as extra width.
const FRAME =
  'border border-edge-2l dark:border-edge-2d hover:border-edge-3l dark:hover:border-edge-3d';

const VARIANT: Record<KeyActionVariant, string> = {
  accept:
    'bg-surface-1l dark:bg-surface-1d text-content-1l dark:text-content-1d hover:bg-surface-3l dark:hover:bg-surface-3d',
  danger:
    'bg-danger-500l dark:bg-danger-500d text-on-accent hover:bg-danger-600l dark:hover:bg-danger-600d active:bg-danger-600l dark:active:bg-danger-600d',
  // Recessed rather than ghosted: on a raised panel a secondary action needs a
  // fill of its own to read as a button at all.
  quiet:
    'bg-surface-1l dark:bg-surface-1d text-content-1l dark:text-content-1d hover:bg-surface-3l dark:hover:bg-surface-3d',
};

// The key rides *inside* the button as a dimmed glyph, not as a boxed cap — a
// bordered chip inside a bordered button reads as a box in a box. Matches
// <HotkeyHint>, which is how a shortcut is shown everywhere else.
const CHIP: Record<KeyActionVariant, string> = {
  accept: 'text-on-accent/65',
  danger: 'text-on-accent/65',
  quiet: 'text-content-3l dark:text-content-3d',
};

export interface KeyActionProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Omit for a key-only button — the chip becomes the whole control. */
  label?: string;
  /** Material Symbols glyph for the chip (`keyboard_return`, `keyboard_tab`). */
  keyGlyph?: string;
  /** Literal key text for the chip (`esc`), when no glyph reads clearly. */
  keyText?: string;
  variant?: KeyActionVariant;
}

/** A panel action that can wear the key firing it. The sheet's own buttons run
 *  bare — ⏎ and esc need no teaching, and annotating them crowds the row — so the
 *  chip is for actions whose shortcut isn't already obvious. Sized to match
 *  `<Button>`, since the two share dialog footers and toolbars. */
export function KeyAction({
  label,
  keyGlyph,
  keyText,
  variant = 'quiet',
  className,
  type = 'button',
  ...rest
}: KeyActionProps) {
  const chip = keyGlyph || keyText;
  return (
    <button
      type={type}
      className={cn(
        BASE,
        FRAME,
        VARIANT[variant],
        label ? 'px-space-7 h-8' : 'px-space-4 h-7',
        className
      )}
      {...rest}
    >
      {label}
      {chip && (
        <kbd
          aria-hidden
          className={cn(
            'font-sans text-[11px] leading-none tracking-normal not-italic tabular-nums',
            CHIP[variant]
          )}
        >
          {keyGlyph ? <Icon name={keyGlyph} size={14} weight={300} /> : keyText}
        </kbd>
      )}
    </button>
  );
}
