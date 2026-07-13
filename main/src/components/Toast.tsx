import { Icon } from '@taskscape/common-ui/Icon';
import { useToastStore } from '../stores/toastStore';

/** The single transient toast (bottom-center), e.g. an undoable delete. */
export function Toast() {
  const toast = useToastStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="z-overlay pointer-events-none fixed inset-x-0 bottom-5 flex justify-center">
      <div className="animate-rise rounded-control bg-surface-3l dark:bg-surface-3d border-edge-2l dark:border-edge-2d shadow-lift pointer-events-auto flex items-center gap-3 border py-2 pr-2 pl-3.5">
        <span className="text-content-1l dark:text-content-1d text-[13px] font-medium">
          {toast.message}
        </span>
        {toast.action && (
          <button
            onClick={() => {
              toast.action?.();
              useToastStore.getState().dismiss();
            }}
            className="rounded-field text-accent-500l dark:text-accent-500d hover:bg-wash-1l dark:hover:bg-wash-1d flex h-7 items-center gap-1 px-2 text-[12.5px] font-semibold"
          >
            <Icon name="undo" size={14} />
            {toast.actionLabel ?? 'Undo'}
          </button>
        )}
        <button
          onClick={() => useToastStore.getState().dismiss()}
          className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-7 w-7 place-items-center"
          title="Dismiss"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
