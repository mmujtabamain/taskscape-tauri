import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** A ref that always holds the latest `value`, updated after each commit. Lets a
 *  stable listener (registered once) read fresh state without re-subscribing. */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** A stable callback whose identity never changes but which always invokes the
 *  latest `fn`. Replaces the hand-rolled "latest-ref + no-dep effect" pattern so
 *  event listeners can subscribe once and still call fresh closures. */
export function useEvent<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
