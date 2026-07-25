/** The card lives in a window taller than itself so its notes have room to grow.
 *  On each reveal Rust reports (via the `mini-shown` payload) which window edge to
 *  pin the card to — `"top"` (grows downward) when summoned near the top of the
 *  screen, `"bottom"` (grows upward) when summoned near the bottom — so the card
 *  always lands at the cursor. The class is toggled imperatively on <html> (like
 *  the cursor-autohide class) and read by `#root`'s `justify-content` in the CSS.
 *
 *  It also gates the card's visibility: `.bar-ready` is what makes the card paint.
 *  The card stays hidden between a `dismiss` (`mini-hidden`) and the next reveal,
 *  so a reveal never shows it at the previous summon's anchor for a frame before
 *  the new one is applied. The window backing is transparent, so a hidden card
 *  simply shows nothing. */
export function applyAnchor(anchor: string): void {
  const root = document.documentElement;
  root.classList.toggle('anchor-bottom', anchor === 'bottom');
  root.classList.add('bar-ready');
}

/** Hide the card until the next reveal reports its anchor. */
export function hideCard(): void {
  document.documentElement.classList.remove('bar-ready');
}
