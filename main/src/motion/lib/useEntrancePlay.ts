import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

// Plays a mount entrance reliably — even on a cached reload.
//
// The routed body wraps every page in <AnimatePresence initial={false}> (see
// PageTransition), which suppresses MOUNT entrances for anything present on the
// first render. On a cold visit the lazy page chunk streams in late, so a
// masthead element mounts after that first render and animates fine; on a cached
// reload it's present immediately and would snap straight to its end state.
//
// The dodge: don't rely on the mount entrance. Return `play=false` on mount,
// then flip it to `true` one frame later, so the element animates hidden→shown
// as a PROP-CHANGE animation (which AnimatePresence does not suppress). The flip
// lives in a requestAnimationFrame callback — never a synchronous setState in
// the effect body — matching the CountUp pattern. With reduced motion there's
// nothing to play, so `play` is true from the start.
export function useEntrancePlay(): { reduce: boolean; play: boolean } {
  const reduce = useReducedMotion();
  const [play, setPlay] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const raf = requestAnimationFrame(() => setPlay(true));
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  return { reduce: !!reduce, play: reduce || play };
}
