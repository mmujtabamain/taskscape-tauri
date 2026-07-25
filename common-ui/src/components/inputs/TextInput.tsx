import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@taskscape/common-ui/cn';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Transparent, chrome-less input for use inside an <InputWell>. */
  bare?: boolean;
}

/** A filled text input (with focus ring) or, when `bare`, a transparent input to
 *  drop inside an <InputWell>. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { bare = false, className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'text-[13px] text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d outline-none',
        bare
          ? 'min-w-0 flex-1 bg-transparent'
          : 'h-7 rounded-field bg-surface-0l dark:bg-surface-0d px-space-6 focus:ring-2 focus:ring-focus-1l dark:focus:ring-focus-1d',
        className
      )}
      {...rest}
    />
  );
});
