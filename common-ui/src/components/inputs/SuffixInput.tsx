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
}

const strip = (s: string) => s.replace(/\./g, '');

/** A field with a locked tail: the editable name grows to fit its text so the
 *  greyed suffix stays glued to its right edge, and no `.` can get in — typed
 *  dots are swallowed and pasted ones stripped, so the extension can't be
 *  redefined from inside the field. */
export const SuffixInput = forwardRef<HTMLInputElement, SuffixInputProps>(
  function SuffixInput(
    { value, onValueChange, suffix, placeholder, className, ...rest },
    ref
  ) {
    return (
      <InputWell
        className={cn('h-9', className)}
        trailing={
          <Label
            tone="muted"
            className="text-[13px] whitespace-pre select-none"
          >
            {suffix}
          </Label>
        }
      >
        <span className="relative inline-flex max-w-full min-w-[1ch] flex-none">
          {/* Sizer: the well shrink-wraps the text, which is what glues the
              suffix to the name instead of to the field's right edge. */}
          <span
            aria-hidden
            className="invisible overflow-hidden text-[13px] whitespace-pre"
          >
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
              // Swallowed rather than stripped after the fact, so the caret
              // never jumps over a character that was never inserted.
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
            className="text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d absolute inset-0 w-full bg-transparent text-[13px] outline-none"
          />
        </span>
      </InputWell>
    );
  }
);
