import { useEffect, useRef, useState, type RefObject } from 'react';

// Latches `true` the first time the element scrolls into view, then stops
// watching. The observer is created in an effect — i.e. after the first
// layout/paint — so a below-the-fold element reads as genuinely out of view and
// does NOT trigger at mount.
//
// This is why we don't use motion's own `whileInView` / `useInView`: in this app
// they were resolving as in-view for off-screen elements during the initial
// commit, so every section animated to visible immediately and never played on
// scroll (and the entrance didn't replay on a cached reload). Driving `animate`
// off this latch instead makes the reveal a prop-change animation that fires on
// the real intersection — reliable on scroll and on reload alike.
//
// `active` gates the observer (pass `false` under reduced motion). `threshold` is
// the fraction of the element that must be visible to count as in view.
export function useInViewOnce<T extends Element>(
  ref: RefObject<T | null>,
  active = true,
  threshold = 0.15
): boolean {
  // Start visible where IntersectionObserver can't run (SSR / unsupported) so
  // content is never stranded hidden; in the browser it starts hidden and the
  // observer reveals it on first intersection.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    if (!active) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, active, threshold]);

  return inView;
}

// A ready-to-use ref + latch pair for the common case of one observed element.
export function useRevealOnView<T extends Element>(
  active = true,
  threshold = 0.15
): { ref: RefObject<T | null>; inView: boolean } {
  const ref = useRef<T>(null);
  const inView = useInViewOnce(ref, active, threshold);
  return { ref, inView };
}
