import { cn } from '@taskscape/common-ui/cn';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** A pill switch (settings). No transition, per the app's motion policy. */
export function Toggle({
  checked,
  onChange,
  disabled,
  title,
  className,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-8.5 shrink-0 items-center rounded-full border disabled:pointer-events-none disabled:opacity-40',
        checked
          ? 'bg-accent-500l dark:bg-accent-500d border-transparent'
          : 'border-edge-2l dark:border-edge-2d bg-surface-0l dark:bg-surface-0d',
        className
      )}
    >
      <span
        className={cn(
          'bg-surface-3l dark:bg-surface-3d shadow-lift grid h-4 w-4 place-items-center rounded-full',
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}
