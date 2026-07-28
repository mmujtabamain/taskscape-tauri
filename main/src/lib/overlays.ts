// The overlay-depth tracker now lives in the shared library, alongside <Overlay>
// itself, so both apps count depth the same way and overlays register themselves
// on mount instead of each one remembering to. Re-exported here because the app's
// global key map is the only consumer that needs to *read* the count.
export { overlayOpen } from '@taskscape/common-ui/overlay';
