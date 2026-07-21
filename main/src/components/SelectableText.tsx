import { cn } from '@taskscape/common-ui/cn';
import type { ComponentPropsWithoutRef, ElementType } from 'react';

/**
 * The one surface in the app where text may be selected. Global CSS locks
 * `user-select` everywhere for a native desktop-app feel (see index.css); wrap
 * any *read-only* text that must stay copyable in this and nothing else.
 *
 * Editable controls (input / textarea / the rich-text editor) are selectable on
 * their own — they don't and shouldn't use this. Renders a <span> by default;
 * pass `as` for another tag, e.g. `<SelectableText as="pre">`.
 */
export function SelectableText<T extends ElementType = 'span'>({
  as,
  className,
  ...rest
}: { as?: T; className?: string } & Omit<
  ComponentPropsWithoutRef<T>,
  'as' | 'className'
>) {
  const Tag = (as ?? 'span') as ElementType;
  return <Tag className={cn('selectable-text', className)} {...rest} />;
}
