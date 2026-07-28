import { Icon } from '@taskscape/common-ui/Icon';
import {
  EmptyState,
  IconButton,
  Label,
  TitleBar,
  ToolbarButton,
} from '@taskscape/common-ui/components';
import { useEffect } from 'react';
import { askConfirm } from '../lib/sheet';
import { DialogControls } from './WindowControls';
import { controlsSide } from './windowChrome';
import { useListStore } from '../stores/listStore';
import { useTrashStore } from '../stores/trashStore';
import { relativeTime } from '../time';

/** The Trash view, hosted in the preview pane: soft-deleted tasks with per-item
 *  Restore / Delete-forever, plus Restore-all and Empty-trash. */
export function TrashPane({ onClose }: { onClose: () => void }) {
  const items = useTrashStore((s) => s.items);
  const loading = useTrashStore((s) => s.loading);
  const lists = useListStore((s) => s.lists);

  useEffect(() => {
    void useTrashStore.getState().load();
  }, []);

  // Only show the roots of each deleted forest (a stamped child of a stamped
  // parent restores/purges with it).
  const ids = new Set(items.map((t) => t.id));
  const roots = items.filter((t) => !(t.parent_id && ids.has(t.parent_id)));

  const listName = (id: string) => lists.find((l) => l.id === id)?.name;

  const restoreAll = () =>
    useTrashStore.getState().restore(roots.map((t) => t.id));
  const emptyTrash = async () => {
    const ok = await askConfirm({
      glyph: 'delete_forever',
      tone: 'danger',
      headline: 'Empty Trash?',
      detail: `${items.length} task${items.length === 1 ? '' : 's'} deleted for good. No undo.`,
      accept: 'Empty Trash',
    });
    if (ok) await useTrashStore.getState().empty();
  };

  return (
    <div className="bg-surface-1l dark:bg-surface-1d flex h-full w-full flex-col">
      <TitleBar
        title="Trash"
        border="edge-1"
        leading={
          <Icon
            name="delete"
            size={18}
            weight={300}
            className="text-content-2l dark:text-content-2d shrink-0"
          />
        }
        controls={
          <DialogControls onClose={onClose} closeTitle="Close Trash" />
        }
        controlsSide={controlsSide}
      />

      {roots.length > 0 && (
        <div className="border-edge-1l dark:border-edge-1d gap-space-3 px-space-6 py-space-5 flex shrink-0 items-center border-b">
          <ToolbarButton icon="restore" iconSize={14} onClick={restoreAll}>
            Restore all
          </ToolbarButton>
          <ToolbarButton
            icon="delete_forever"
            iconSize={14}
            variant="danger"
            className="ml-auto"
            onClick={emptyTrash}
          >
            Empty
          </ToolbarButton>
        </div>
      )}

      <div className="p-space-5 min-h-0 flex-1 overflow-y-auto">
        {roots.length === 0 && (
          <EmptyState
            icon="delete"
            iconSize={28}
            title={loading ? 'Loading…' : 'Trash is empty'}
            className="py-16"
          />
        )}
        {roots.map((t) => (
          <div
            key={t.id}
            className="group/trash rounded-field hover:bg-wash-1l dark:hover:bg-wash-1d gap-space-5 px-space-5 flex h-9 items-center"
          >
            <div className="min-w-0 flex-1">
              <Label as="div" tone="primary" truncate className="text-[13.5px]">
                {t.title}
              </Label>
              <Label as="div" tone="muted" truncate className="text-[11px]">
                {listName(t.list_id) ? `${listName(t.list_id)} · ` : ''}
                {t.deleted_at ? `deleted ${relativeTime(t.deleted_at)}` : ''}
              </Label>
            </div>
            <IconButton
              icon="restore"
              size="lg"
              iconSize={16}
              variant="ghostStrong"
              className="opacity-0 group-hover/trash:opacity-100"
              onClick={() => useTrashStore.getState().restore([t.id])}
              title="Restore"
            />
            <IconButton
              icon="delete_forever"
              size="lg"
              iconSize={16}
              variant="danger"
              className="opacity-0 group-hover/trash:opacity-100"
              onClick={() => useTrashStore.getState().purge([t.id])}
              title="Delete permanently"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
