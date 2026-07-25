import { extendTailwindMerge, type ClassNameValue } from 'tailwind-merge';

/* tailwind-merge only knows Tailwind's stock value vocabulary — numbers, t-shirt
 * sizes, arbitrary values. Every scale we name in `styles/tokens.css` is invisible
 * to it, so `twMerge('rounded-field', 'rounded-full')` would keep BOTH classes and
 * let stylesheet order silently decide the winner. Registering the token names
 * below restores last-wins for them.
 *
 * Keep in sync with the `@theme` blocks in `common-ui/styles/tokens.css`. Colors
 * are deliberately absent: tailwind-merge's color groups accept any value, so
 * `bg-surface-1l` / `text-content-3l` / `border-edge-2l` already merge correctly. */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        'space-1',
        'space-2',
        'space-3',
        'space-4',
        'space-5',
        'space-6',
        'space-7',
        'space-8',
      ],
      radius: ['field', 'control', 'panel'],
      shadow: ['menu', 'lift'],
      ease: ['standard', 'exit'],
      font: ['display'],
      // `rise`/`panel-in` are --animate-* tokens; the rest are hand-written
      // `.animate-*` classes in tokens.css sharing the same utility namespace.
      animate: ['rise', 'panel-in', 'fade-in-up', 'fade-in', 'scale-in'],
    },
    classGroups: {
      // Not theme keys in tailwind-merge — extended so `z-modal` and `z-50` land
      // in one group, and likewise for the --duration-* ramp.
      z: [{ z: ['base', 'raised', 'popover', 'dropdown', 'overlay', 'modal', 'tooltip'] }],
      duration: [{ duration: ['fast', 'base', 'slow'] }],
    },
  },
});

/** Compose Tailwind class names, resolving conflicts (last wins) and dropping
 *  falsy values — `cn('p-2', cond && 'p-4', maybe)`. Prefer this over template
 *  literals for any className built from conditionals. */
export const cn = (...classes: ClassNameValue[]): string => merge(classes);
