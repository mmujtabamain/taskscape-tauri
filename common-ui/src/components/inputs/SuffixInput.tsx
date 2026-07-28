import { cn } from '@taskscape/common-ui/cn';
import { InputWell } from '@taskscape/common-ui/components/inputs/InputWell';
import { Label } from '@taskscape/common-ui/components/typography/Label';
import { forwardRef, type InputHTMLAttributes } from 'react';

export interface SuffixInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (next: string) => void;
  /** The locked, greyed tail — a file extension (`.png`). It is never editable
   *  and is not part of `value`; append it yourself when you commit. */
  suffix: string;
  /** Drop the recessed well: transparent and chrome-less, inheriting the type
   *  size — for a field that is itself the body of a panel. */
  bare?: boolean;
}

const strip = (s: string) => s.replace(/\./g, '');

/** A field with a locked tail: the editable name grows to fit its text so the
 *  greyed suffix stays glued to its right edge, and no `.` can get in — typed
 *  dots are swallowed and pasted ones stripped, so the extension can't be
 *  redefined from inside the field. */
export const SuffixInput = forwardRef<HTMLInputElement, SuffixInputProps>(
  function SuffixInput(
    {
      value,
      onValueChange,
      suffix,
      bare = false,
      placeholder,
      className,
      ...rest
    },
    ref
  ) {
    const field = (
      <span className="relative inline-flex max-w-full min-w-[1ch] flex-none">
        {/* Sizer: the name shrink-wraps its text, which is what glues the suffix
            to the name instead of to the field's right edge. */}
        <span aria-hidden className="invisible overflow-hidden whitespace-pre">
          {value || placeholder || '​'}
        </span>
        <input
          ref={ref}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          {...rest}
          onChange={(e) => onValueChange(strip(e.target.value))}
          onKeyDown={(e) => {
            // Swallowed rather than stripped after the fact, so the caret never
            // jumps over a character that was never inserted.
            if (e.key === '.') e.preventDefault();
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (!text.includes('.')) return;
            e.preventDefault();
            const el = e.currentTarget;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            onValueChange(
              el.value.slice(0, start) + strip(text) + el.value.slice(end)
            );
          }}
          className="text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d absolute inset-0 w-full bg-transparent outline-none"
        />
      </span>
    );

    const tail = (
      <Label tone="muted" className="whitespace-pre select-none">
        {suffix}
      </Label>
    );

    if (bare)
      return (
        <div className={cn('gap-space-4 flex min-w-0 items-center', className)}>
          {field}
          {tail}
        </div>
      );

    return (
      <InputWell className={cn('h-9 text-[13px]', className)} trailing={tail}>
        {field}
      </InputWell>
    );
  }
);
