import { cn } from '@taskscape/common-ui/cn';
import { forwardRef, type InputHTMLAttributes } from 'react';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Transparent, chrome-less input for use inside an <InputWell>. */
  bare?: boolean;
}

/** A filled text input (with focus ring) or, when `bare`, a transparent input to
 *  drop inside an <InputWell>. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ bare = false, className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d text-[13px] outline-none',
          bare
            ? 'min-w-0 flex-1 bg-transparent'
            : 'rounded-field bg-surface-0l dark:bg-surface-0d px-space-6 focus:ring-focus-1l dark:focus:ring-focus-1d h-7 focus:ring-2',
          className
        )}
        {...rest}
      />
    );
  }
);
