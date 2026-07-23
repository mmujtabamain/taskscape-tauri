import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';

/** The square "done" checkbox used in the inspector header and subtask/selection
 *  rows (distinct from the row gutter's dual-mode Check). */
export function DoneCheckbox({
  done,
  size,
  onToggle,
}: {
  done: boolean;
  size: 14 | 18;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={done ? 'Mark not done' : 'Mark done'}
      className={cn(
        'rounded-field grid shrink-0 place-items-center border-[1.5px]',
        size === 18 ? 'h-5 w-5' : 'h-4.5 w-4.5',
        done
          ? 'bg-done-lamp-1l dark:bg-done-lamp-1d text-on-accent border-transparent'
          : 'border-edge-3l dark:border-edge-3d hover:border-content-3l dark:hover:border-content-3d'
      )}
    >
      {done && <Icon name="check" size={size === 18 ? 14 : 12} weight={700} />}
    </button>
  );
}
