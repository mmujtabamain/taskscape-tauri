import { Icon } from '@taskscape/common-ui/Icon';
import { useEffect } from 'react';
import { confirmModal } from '../lib/modal';
import { setOverlay } from '../lib/overlays';
import { useListStore } from '../stores/listStore';
import { useTrashStore } from '../stores/trashStore';
import { relativeTime } from '../time';

/** The Trash overlay: soft-deleted tasks with per-item Restore / Delete-forever,
 *  plus Restore-all and Empty-trash. */
export function TrashPane({ onClose }: { onClose: () => void }) {
  const items = useTrashStore((s) => s.items);
  const loading = useTrashStore((s) => s.loading);
  const lists = useListStore((s) => s.lists);

  useEffect(() => {
    setOverlay(true);
    void useTrashStore.getState().load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      setOverlay(false);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Only show the roots of each deleted forest (a stamped child of a stamped
  // parent restores/purges with it).
  const ids = new Set(items.map((t) => t.id));
  const roots = items.filter((t) => !(t.parent_id && ids.has(t.parent_id)));

  const listName = (id: string) => lists.find((l) => l.id === id)?.name;

  const restoreAll = () => useTrashStore.getState().restore(roots.map((t) => t.id));
  const emptyTrash = async () => {
    const ok = await confirmModal({
      danger: true,
      title: 'Empty Trash?',
      message: `${items.length} task${items.length === 1 ? '' : 's'} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Empty Trash',
    });
    if (ok) await useTrashStore.getState().empty();
  };

  return (
    <div
      className="z-overlay fixed inset-0 flex items-center justify-center bg-black/30"
      onMouseDown={onClose}
    >
      <div
        className="rounded-control bg-surface-1l dark:bg-surface-1d border-edge-2l dark:border-edge-2d shadow-lift flex max-h-[76vh] w-[min(560px,92vw)] flex-col overflow-hidden border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-edge-1l dark:border-edge-1d flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
          <Icon name="delete" size={19} weight={300} className="text-content-2l dark:text-content-2d" />
          <span className="font-display text-content-1l dark:text-content-1d flex-1 text-[15px] font-semibold">
            Trash
          </span>
          {roots.length > 0 && (
            <>
              <button
                onClick={restoreAll}
                className="rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d flex h-7 items-center gap-1 px-2 text-[12px] font-semibold"
              >
                <Icon name="restore" size={14} />
                Restore all
              </button>
              <button
                onClick={emptyTrash}
                className="rounded-field text-danger-500l dark:text-danger-500d hover:bg-danger-100l dark:hover:bg-danger-100d flex h-7 items-center gap-1 px-2 text-[12px] font-semibold"
              >
                <Icon name="delete_forever" size={14} />
                Empty
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-7 w-7 place-items-center"
            title="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {roots.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-16 text-center">
              <Icon name="delete" size={28} weight={200} className="text-content-3l dark:text-content-3d" />
              <p className="text-content-2l dark:text-content-2d text-[14px] font-medium">
                {loading ? 'Loading…' : 'Trash is empty'}
              </p>
            </div>
          )}
          {roots.map((t) => (
            <div
              key={t.id}
              className="group/trash rounded-field hover:bg-wash-1l dark:hover:bg-wash-1d flex h-10 items-center gap-2.5 px-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-content-1l dark:text-content-1d truncate text-[13.5px]">
                  {t.title}
                </div>
                <div className="text-content-3l dark:text-content-3d truncate text-[11px]">
                  {listName(t.list_id) ? `${listName(t.list_id)} · ` : ''}
                  {t.deleted_at ? `deleted ${relativeTime(t.deleted_at)}` : ''}
                </div>
              </div>
              <button
                onClick={() => useTrashStore.getState().restore([t.id])}
                title="Restore"
                className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d grid h-7 w-7 shrink-0 place-items-center opacity-0 transition-opacity group-hover/trash:opacity-100"
              >
                <Icon name="restore" size={16} />
              </button>
              <button
                onClick={() => useTrashStore.getState().purge([t.id])}
                title="Delete permanently"
                className="rounded-field text-content-3l dark:text-content-3d hover:bg-danger-100l dark:hover:bg-danger-100d hover:text-danger-500l dark:hover:text-danger-500d grid h-7 w-7 shrink-0 place-items-center opacity-0 transition-opacity group-hover/trash:opacity-100"
              >
                <Icon name="delete_forever" size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
