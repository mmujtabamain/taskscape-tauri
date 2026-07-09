import type { Transition, Variants } from 'motion/react';

// Centralized motion tokens — the single easing curve + timing band, mirrored
// from the CSS custom properties in src/index.css. Components build their
// variants from these so durations/easings are never hardcoded ad hoc.

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  fast: 0.18,
  base: 0.28,
  slow: 0.5,
} as const;

// Grow → dissolve reveal, in seconds. An amber form blooms to full size (grow),
// then dissolves to hand off to its content — the coin→logo in BrandGlyph, the
// amber cover→photo in RevealImage. Shared so every Hero reveal reads as one
// gesture; `delay` cascades a stack of them.
export const REVEAL = { grow: 0.45, dissolve: 0.4 } as const;

// The keyframe transition for a grow→dissolve reveal: a [start, full, end]
// keyframe array split at the grow/dissolve boundary, so a value can hold
// through the grow and then act over the dissolve tail.
export function revealTransition(delay = 0): Transition {
  const total = REVEAL.grow + REVEAL.dissolve;
  return {
    duration: total,
    ease: EASE_OUT,
    times: [0, REVEAL.grow / total, 1],
    delay,
  };
}

// A fade + small upward rise — the one scroll-in entrance used site-wide.
// `i` (custom) staggers list items: each waits `i * step` before starting.
export function makeReveal(distance = 14, step = 0.07): Variants {
  return {
    hidden: { opacity: 0, y: distance },
    visible: (i: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: DURATION.slow,
        ease: EASE_OUT,
        delay: i * step,
      } satisfies Transition,
    }),
  };
}

// Header lines cascade like the Eyebrow's beats: each enters this much after the
// one above it.
export const HEADER_TEXT_STAGGER = 0.12;

// The section-header title rise, in seconds. A heading line sits behind a
// baseline mask and the type rises up into place from below — the third reveal
// signature alongside the Eyebrow's horizontal rule-wipe and RevealImage's
// bloom. On the entrance band (longer than the slow state band) so it reads as
// the type settling into the grid, never hurried.
export const HEADER_RISE = 0.72;

// The title's mask-rise. The wrapping clip window (HeaderReveal.Line) hides the
// line; here the type travels up from fully below it (`120%` clears descenders
// and umlauts even on the tightest hero line-height) to its resting place. Full
// opacity throughout: the mask does the revealing, so the letters arrive crisp,
// not faded — the calm, confident counterpart to a soft cross-fade. `i` (custom,
// the line's reading order) cascades stacked headings a `step` apart.
export function headerMaskVariants(
  start: number = 0,
  step: number = HEADER_TEXT_STAGGER
): Variants {
  return {
    hidden: { y: '120%' },
    visible: (i: number = 0) => ({
      y: '0%',
      transition: {
        duration: HEADER_RISE,
        ease: EASE_OUT,
        delay: start + i * step,
      } satisfies Transition,
    }),
  };
}

// The section header's supporting lines — the lead and the actions row beneath
// the title. A quiet fade + a few-px rise, deliberately smaller and softer than
// the title's mask-rise so it reads as the secondary beat that settles in behind
// the title, not a second performance. No leading delay (`start` 0): it begins
// the moment the header scrolls into view, then `i` (custom, the line's reading
// order) cascades lead → actions a `step` apart, riding just behind the title.
export function headerTextVariants(
  start: number = 0,
  step: number = HEADER_TEXT_STAGGER
): Variants {
  return {
    hidden: { opacity: 0, y: 10 },
    visible: (i: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: DURATION.slow,
        ease: EASE_OUT,
        delay: start + i * step,
      } satisfies Transition,
    }),
  };
}

// When several Eyebrows reveal together (see lib/eyebrowCascade), each starts
// this much later than the one above / to the left of it, so the group cascades
// in reading order instead of firing all at once.
export const EYEBROW_STAGGER = 0.36;

// Eyebrow intro — a three-beat chain meant to play once the wrapping `Reveal`
// has settled (`start` defaults to that reveal's duration): the index numeral
// fades in, the amber rule then wipes left→right, and finally the label wipes in
// from the left. Returned as separate per-part variants so the parts inherit one
// parent state but fire in series via their own delays. With no index numeral its
// beat is skipped, so the rule starts straight away. The label is `shown` (not
// `visible`) so it never collides with a wrapping Reveal's variant — the Eyebrow
// drives its own `animate` (see useEntrancePlay) rather than inheriting it.
export function eyebrowVariants(
  start: number = DURATION.slow,
  hasIndex: boolean = true
): { index: Variants; strip: Variants; label: Variants } {
  const afterIndex = start + (hasIndex ? DURATION.base : 0);
  const afterStrip = afterIndex + DURATION.base;
  return {
    index: {
      hidden: { opacity: 0 },
      shown: {
        opacity: 1,
        transition: { duration: DURATION.base, ease: EASE_OUT, delay: start },
      },
    },
    strip: {
      hidden: { scaleX: 0 },
      shown: {
        scaleX: 1,
        transition: {
          duration: DURATION.base,
          ease: EASE_OUT,
          delay: afterIndex,
        },
      },
    },
    label: {
      hidden: { opacity: 0, clipPath: 'inset(0 100% 0 0)' },
      shown: {
        opacity: 1,
        clipPath: 'inset(0 0 0 0)',
        transition: {
          duration: DURATION.slow,
          ease: EASE_OUT,
          delay: afterStrip,
        },
      },
    },
  };
}

// Scroll-in reveals are triggered by our own IntersectionObserver
// (lib/useInViewOnce), not motion's `whileInView` — see that hook for why.

// Page-switch transition: the outgoing page slides out + fades while the
// incoming one slides into its place. The axis is DIRECTIONAL — set by where the
// target sits in the navbar order (see PageTransition):
//   'forward'  → later page: new enters from the right, old leaves to the left
//   'backward' → earlier page: new enters from the left, old leaves to the right
//   'up'       → off-axis routes (legal/404): new rises from below, old lifts up
// Driven by AnimatePresence (mode="wait") so only one page is on screen at a
// time; gated on reduced-motion at the call site. Exit uses the faster band so
// the new page arrives promptly. Variants are dynamic — the direction is passed
// as `custom` to both AnimatePresence (for the exiting page) and the entering
// motion element.
export type PageDirection = 'forward' | 'backward' | 'up';

export const PAGE_SLIDE = 36;

// Where the page starts (initial) / ends (exit) for a given travel direction.
function offset(dir: PageDirection, sign: 1 | -1) {
  if (dir === 'up') return { x: 0, y: sign * PAGE_SLIDE };
  const x = (dir === 'forward' ? sign : -sign) * PAGE_SLIDE;
  return { x, y: 0 };
}

export const pageTransition: Variants = {
  initial: (dir: PageDirection = 'forward') => ({
    opacity: 0,
    ...offset(dir, 1),
  }),
  enter: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: {
      duration: DURATION.base,
      ease: EASE_OUT,
    } satisfies Transition,
  },
  exit: (dir: PageDirection = 'forward') => ({
    opacity: 0,
    ...offset(dir, -1),
    transition: {
      duration: DURATION.fast,
      ease: EASE_OUT,
    } satisfies Transition,
  }),
};
