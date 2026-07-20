import { api } from '../api';

/** Dismiss index.html's #boot veil once the app has loaded: fade the whole
 *  overlay (blur + tint + checkbox) out, then remove it and the native boot
 *  box drawn behind the page.
 *
 *  The fade runs through the Web Animations API rather than a CSS transition on
 *  purpose. Under "Reduce Motion" / Low Power Mode, tokens.css clamps every CSS
 *  transition/animation duration to ~0 with `!important` (`* { … }`), and an
 *  inline `#boot` transition can't reliably beat that — so the veil would snap
 *  instead of fade. `element.animate()` isn't a CSS transition, so the clamp
 *  never touches it, and this deliberate loading feedback fades in every motion
 *  mode. (The tick + #root content fade stay CSS animations; they out-weigh the
 *  clamp on id-level specificity — see index.html.)
 *
 *  Double-rAF so the loaded app has painted beneath the veil before the fade
 *  starts. Idempotent — guarded so StrictMode's double effect run fades once. */
export function dismissBoot() {
  const boot = document.getElementById('boot');
  if (!boot || boot.dataset.dismissing) return;
  boot.dataset.dismissing = '1';
  boot.style.pointerEvents = 'none';
  void api.bootDone();
  const remove = () => boot.remove();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const fade = boot.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 300,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'forwards',
      });
      fade.onfinish = remove;
      // Fallback if `finish` never fires (e.g. the animation is cancelled).
      setTimeout(remove, 600);
    })
  );
}
