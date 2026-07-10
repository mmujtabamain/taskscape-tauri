# motion/ — foundation ported from punkt_xii (author your own components)

Motion **foundation** (tokens + hooks) copied from the punkt_xii reference app.
The punkt components were removed — you'll author your own on top of this. Nothing
here is imported by the app yet, and the folder is **excluded from the TypeScript
build** (`tsconfig.json` `exclude`), so it's pure staging.

Runtime deps available: `motion` (Framer Motion) and `tailwind-merge`.

## What's here (`lib/`)

- `motion.ts` — motion tokens (`EASE_OUT`, `DURATION`, `REVEAL`) + variant
  factories. The **reusable** bits: `makeReveal`, `revealTransition`, `pageTransition`.
  The rest (`eyebrowVariants`, `headerMaskVariants`, `headerTextVariants`,
  `HEADER_*`, `EYEBROW_STAGGER`) were shaped for punkt's specific components — keep,
  adapt, or delete as you build your own. Mirrors the CSS tokens `--ease-out` /
  `--duration-*` in `src/index.css`.
- `useInViewOnce.ts` — scroll-in latch via IntersectionObserver (generic, reusable).
- `useMediaQuery.ts` — `useIsMobile` / `useIsTablet` (generic, reusable).
- `useEntrancePlay.ts` — replay-on-mount entrance trigger (generic).
- `eyebrowCascade.ts` — punkt's eyebrow-group choreography; orphaned now, kept for
  reference.

## When you author a component

Put it under `src/` (not here) so it's compiled, and import the tokens/hooks you
want from `src/motion/lib/…`. If you want a `cn()` className helper, `tailwind-merge`
is installed — write a one-liner or import `twMerge` directly.
