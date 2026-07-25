import { useEffect, type RefObject } from 'react';
import { api } from '../api';

/** Keep the window exactly as tall as the card. The window backing is
 *  transparent but not click-through, so any part of it the card doesn't cover
 *  would swallow clicks meant for whatever is underneath. Rust holds the
 *  summon's anchored edge still, so the card grows away from the cursor instead
 *  of drifting off it. */
export function useBarAutoResize(cardRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let last = 0;
    const observer = new ResizeObserver(() => {
      // The border box — the card's 1px border is part of what's painted.
      const height = Math.ceil(card.getBoundingClientRect().height);
      if (height < 1 || height === last) return;
      last = height;
      void api.setBarHeight(height);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [cardRef]);
}
