import { cn } from '@taskscape/common-ui/cn';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { Icon } from '@taskscape/common-ui/Icon';
import { type RefObject } from 'react';
import { ghostButtonBase, inputClasses } from '../ui';

/** The capture bar's title field plus the (conditional) Clear affordance. */
export function TitleRow({
  title,
  onChange,
  titleRef,
  hasDraft,
  clearAccel,
  onClear,
}: {
  title: string;
  onChange: (v: string) => void;
  titleRef: RefObject<HTMLInputElement | null>;
  hasDraft: boolean;
  clearAccel: string;
  onClear: () => void;
}) {
  return (
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-center px-3 py-2">
      <input
        ref={titleRef}
        autoFocus
        value={title}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Capture a task ..."
        className={cn('flex-1', inputClasses)}
      />

      {hasDraft && (
        <button
          onClick={onClear}
          tabIndex={-1}
          className={cn(
            ghostButtonBase,
            'gap-0 text-[11px]',
            'text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d'
          )}
          title={clearAccel ? `Clear the draft (${formatAccel(clearAccel)})` : 'Clear the draft'}
        >
          <Icon name="delete_sweep" size={16} />
          <p className="px-1">Clear</p>
          {clearAccel && (
            <kbd className="text-content-3l dark:text-content-3d font-sans text-[11px] not-italic">
              {formatAccel(clearAccel)}
            </kbd>
          )}
        </button>
      )}
    </div>
  );
}
