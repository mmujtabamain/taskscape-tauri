// Runtime mirror of the named z-order layers defined as `--z-index-*` tokens in
// src/index.css. Prefer the Tailwind classes (z-raised, z-modal, …) in markup;
// import these only when a layer is needed as an actual integer — e.g. an inline
// zIndex computed at runtime, or a numeric comparison between layers.
//
// This is the single source of truth the z-layer check reads: a raw z-<number>
// in either app's src/ fails `npm run typecheck` via scripts/check-z-layers.mjs.
// Gaps between values leave room to slot new layers in without renumbering. Keep
// in sync with the `--z-index-*` tokens in index.css.
export const zLayers = {
  base: 0,
  raised: 10, // in-content accents, indicators, floating close buttons
  popover: 20, // rich-text inline toolbar
  dropdown: 40, // project switcher
  overlay: 50, // loading veils, toasts, attachment lightbox, command palette
  modal: 60, // sheets — a question sits above the thing it's asked about
  menu: 65, // context menus, which can be raised from any surface incl. a sheet
  tooltip: 70, // mention suggestions (top-most)
} as const;

export type ZLayer = keyof typeof zLayers;
