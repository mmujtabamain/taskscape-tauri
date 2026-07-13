// Pure selection helpers, kept free of React so the tricky set logic is easy to
// reason about (and mirrors the backend's cascade semantics). A "pane" holds an
// ambient multi-selection: the set of picked task ids plus the anchor the last
// range extended from.

export interface PaneSelection {
  ids: Set<string>;
  /** The row a shift-range extends from; the last plainly-selected/toggled row. */
  anchor: string | null;
}

export const EMPTY_SELECTION: PaneSelection = { ids: new Set(), anchor: null };

/** Collapse a selection to the roots of its forest: drop any id that has a
 *  selected ancestor, since every bulk op (delete/move/copy) carries the whole
 *  subtree. Given `A > B` both selected, returns `{A}`. Mirrors the backend's
 *  cascade so counts and previews match what actually happens. */
export function collapseToRoots(
  ids: Iterable<string>,
  parentOf: (id: string) => string | null
): string[] {
  const set = ids instanceof Set ? ids : new Set(ids);
  const roots: string[] = [];
  for (const id of set) {
    let p = parentOf(id);
    while (p != null && !set.has(p)) p = parentOf(p);
    // Reached the top without hitting a selected ancestor → this is a root.
    if (p == null) roots.push(id);
  }
  return roots;
}

/** The inclusive range of ids between `anchor` and `active` along the given
 *  visual order (the pane's `flattenVisible`). Order-independent: works whether
 *  the anchor is above or below the active row. */
export function rangeBetween(
  order: string[],
  anchor: string,
  active: string
): string[] {
  const a = order.indexOf(anchor);
  const b = order.indexOf(active);
  if (a < 0 || b < 0) return active === anchor ? [active] : [active];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

/** Toggle one id's membership, returning a fresh selection with `id` as the new
 *  anchor. */
export function toggle(sel: PaneSelection, id: string): PaneSelection {
  const ids = new Set(sel.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id };
}
