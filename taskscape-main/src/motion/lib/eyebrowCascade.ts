import { useEffect, useRef, useState, type RefObject } from 'react';
import { EYEBROW_STAGGER } from './motion';

// Coordinates Eyebrow reveals so that when several enter the viewport together
// they animate in reading order — topmost first, then leftmost on a shared row —
// each delayed a step behind the one before it, rather than all firing at once.
//
// Detection: a single shared IntersectionObserver watches every mounted eyebrow.
// The browser already coalesces simultaneous threshold crossings into one
// callback (this is the page-load / band-reveal batch); we extend that with a
// short LEADING window (WINDOW_MS) so eyebrows that cross on *adjacent* frames
// during a fast scroll still count as one group. When the window closes we
// snapshot positions in a single layout read, sort top→left, and hand each
// member its stagger delay. A lone eyebrow is just a group of one (delay 0).
//
// Reveal is once-only: a member is unobserved and forgotten the first time it
// intersects, mirroring useInViewOnce, so the entrance never replays.

type Member = { el: Element; reveal: (delay: number) => void };

const THRESHOLD = 0.15;
const WINDOW_MS = 50; // collection window; spans a few frames so adjacent-frame crossings group
const ROW_TOLERANCE = 24; // px: tops within this band count as the same row, tie-broken by left

const members = new Map<Element, Member>();
let observer: IntersectionObserver | null = null;
let pending: Member[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const group = pending;
  pending = [];

  group
    .filter((m) => m.el.isConnected)
    // Snapshot every position in one pass (one layout read) so the row tiebreak
    // compares a single consistent frame, even if the group spans a fast scroll.
    .map((m) => {
      const rect = m.el.getBoundingClientRect();
      return { m, top: rect.top, left: rect.left };
    })
    .sort((a, b) =>
      Math.abs(a.top - b.top) <= ROW_TOLERANCE ? a.left - b.left : a.top - b.top
    )
    .forEach(({ m }, i) => m.reveal(i * EYEBROW_STAGGER));
}

function ensureObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      let added = false;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const member = members.get(entry.target);
        if (!member) continue;
        members.delete(entry.target); // once-only
        observer!.unobserve(entry.target);
        pending.push(member);
        added = true;
      }
      // Leading window: start the timer on the first crossing and let it run —
      // don't reset it, or a continuous scroll would never flush.
      if (added && timer === null) timer = setTimeout(flush, WINDOW_MS);
    },
    { threshold: THRESHOLD }
  );
  return observer;
}

function register(el: Element, reveal: (delay: number) => void): () => void {
  members.set(el, { el, reveal });
  ensureObserver().observe(el);
  return () => {
    members.delete(el);
    pending = pending.filter((m) => m.el !== el);
    observer?.unobserve(el);
  };
}

// Per-eyebrow hook: a ref to attach, an `inView` latch, and the `delay` the
// controller assigned for this eyebrow's position within its reveal group. The
// eyebrow folds `delay` into its variants' start so the cascade rides on top of
// any `revealDelay`. `active` gates the whole thing (pass `false` under reduced
// motion); where IntersectionObserver can't run we start shown so nothing is
// stranded hidden.
export function useEyebrowCascade<T extends Element>(
  active = true
): {
  ref: RefObject<T | null>;
  inView: boolean;
  delay: number;
} {
  const ref = useRef<T>(null);
  const [state, setState] = useState(() => ({
    inView: typeof IntersectionObserver === 'undefined',
    delay: 0,
  }));

  useEffect(() => {
    if (!active) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    // setState fires later from the controller (IO callback / timer), never
    // synchronously here — so this stays clear of set-state-in-effect.
    return register(el, (delay) => setState({ inView: true, delay }));
  }, [active]);

  return { ref, inView: state.inView, delay: state.delay };
}
