import { useEffect, useState } from 'react';

// Subscribe to a CSS media query and re-render when it flips. The first value is
// read synchronously from `matchMedia` (lazy init), then a `change` listener
// keeps it live — so we never setState synchronously inside the effect
// (react-hooks/set-state-in-effect). Pass a constant query string.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Named viewport bands, single-sourced from Tailwind's `md` (768) and `lg`
// (1024) boundaries plus the project's `wide` breakpoint (1400, registered as
// `--breakpoint-wide` in index.css): phone below `md`, tablet the `md`..below-`lg`
// band, desktop the `lg`..below-`wide` band, wide `wide` and up. The four are
// mutually exclusive and cover every width.
const MD = 768;
const LG = 1024;
const WIDE = 1400;
const BANDS = {
  mobile: { min: 0, max: MD - 1 },
  tablet: { min: MD, max: LG - 1 },
  desktop: { min: LG, max: WIDE - 1 },
  wide: { min: WIDE, max: Infinity },
} as const;

export type Viewport = keyof typeof BANDS;

// True when the viewport spans from the `from` band up through the `to` band
// (inclusive). `useViewportBetween('mobile', 'tablet')` matches any non-desktop
// width; `useViewportBetween('tablet', 'tablet')` matches tablets only.
export function useViewportBetween(from: Viewport, to: Viewport): boolean {
  const { min } = BANDS[from];
  const { max } = BANDS[to];
  const parts: string[] = [];
  if (min > 0) parts.push(`(min-width: ${min}px)`);
  if (Number.isFinite(max)) parts.push(`(max-width: ${max}px)`);
  return useMediaQuery(parts.length ? parts.join(' and ') : '(min-width: 0px)');
}

export const useIsMobile = () => useViewportBetween('mobile', 'mobile');
export const useIsTablet = () => useViewportBetween('tablet', 'tablet');
export const useIsDesktop = () => useViewportBetween('desktop', 'desktop');
export const useIsWide = () => useViewportBetween('wide', 'wide');
