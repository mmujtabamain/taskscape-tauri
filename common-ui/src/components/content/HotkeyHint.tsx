import { cn } from '@taskscape/common-ui/cn';
import { hotkeyTokens, type Hotkey } from '@taskscape/common-ui/hotkeys';
import { Icon } from '@taskscape/common-ui/Icon';
import type { HTMLAttributes } from 'react';

export type HotkeyHintSize = 'sm' | 'md';
export type HotkeyHintTone = 'muted' | 'inherit';

const SIZE: Record<HotkeyHintSize, string> = {
  sm: 'text-[11px]',
  md: 'text-[12px]',
};
// The glyphs carry their own side bearing, so they cluster with no gap — and
// they need a lighter stroke than body icons to sit beside small text.
const ICON_PX: Record<HotkeyHintSize, number> = { sm: 12, md: 13 };
const ICON_WEIGHT = 300;
const TONE: Record<HotkeyHintTone, string> = {
  muted: 'text-content-3l dark:text-content-3d',
  inherit: '',
};

export interface HotkeyHintProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children'
> {
  /** The shortcut to show. `null` (an unbound or unparseable combo) renders
   *  nothing, so callers can pass `parseAccel(…)` straight through. */
  hotkey: Hotkey | null;
  size?: HotkeyHintSize;
  tone?: HotkeyHintTone;
}

/** The one way a shortcut is shown: modifiers and special keys as Material
 *  Symbols glyphs, literal keys as text. `<Keycap>` wraps this when the
 *  shortcut is also clickable to rebind; `formatAccel` covers the places that
 *  need a plain string (tooltips, `title`). */
export function HotkeyHint({
  hotkey,
  size = 'sm',
  tone = 'muted',
  className,
  ...rest
}: HotkeyHintProps) {
  if (!hotkey) return null;
  const tokens = hotkeyTokens(hotkey);
  return (
    <kbd
      aria-label={tokens.map((t) => t.label).join(' ')}
      className={cn(
        'inline-flex items-center font-sans not-italic tabular-nums',
        SIZE[size],
        TONE[tone],
        className
      )}
      {...rest}
    >
      {tokens.map((t, i) =>
        t.kind === 'icon' ? (
          <Icon
            key={i}
            name={t.icon}
            size={ICON_PX[size]}
            weight={ICON_WEIGHT}
          />
        ) : (
          <span key={i}>{t.text}</span>
        )
      )}
    </kbd>
  );
}
