// A tiny module-level registry so the keyboard handler and the command palette
// can focus (and optionally seed) a pane's search field without App owning a ref
// map and drilling it down. Each TaskPane registers its focuser while mounted.
const focusers = new Map<string, (seed?: string) => void>();

export function registerSearchFocus(
  listId: string,
  focus: ((seed?: string) => void) | null
): void {
  if (focus) focusers.set(listId, focus);
  else focusers.delete(listId);
}

/** Focus the pane's search field; `seed` also appends a typed letter. No-op when
 *  the pane isn't mounted. */
export function focusSearch(listId: string, seed?: string): void {
  focusers.get(listId)?.(seed);
}
