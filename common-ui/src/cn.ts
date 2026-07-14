import { twMerge, type ClassNameValue } from 'tailwind-merge';

/** Compose Tailwind class names, resolving conflicts (last wins) and dropping
 *  falsy values — `cn('p-2', cond && 'p-4', maybe)`. Prefer this over template
 *  literals for any className built from conditionals. */
export const cn = (...classes: ClassNameValue[]): string => twMerge(classes);
