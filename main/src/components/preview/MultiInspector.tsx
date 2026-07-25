import { cn } from '@taskscape/common-ui/cn';
import {
  Badge,
  Checkbox,
  IconButton,
  Label,
  SectionHeader,
  ToolbarButton,
} from '@taskscape/common-ui/components';
import { useState } from 'react';
import type { Task } from '../../api';
import {
  bulkCopy,
  bulkDelete,
  bulkMove,
  bulkSetDone,
} from '../../commands/tasks';
import { toggleDone as actToggleDone } from '../../stores/actions';
import { useLayoutStore } from '../../stores/layoutStore';
import { useListStore } from '../../stores/listStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useContextMenu } from '../contextMenuContext';

/** Shown when the focused pane has more than one task selected: a combined tally,
 *  the bulk verbs, and a peek-able list. Clicking a row peeks (highlights without
 *  collapsing the selection); "Open" narrows to that single task. All actions run
 *  against the focused pane's live selection in the stores. */
export function MultiInspector({ tasks }: { tasks: Task[] }) {
  const menu = useContextMenu();
  const activeId = useSelectionStore((s) => s.selectedTaskId);
  const focusedListId = useLayoutStore((s) => s.focusedListId());
  const activeProjectId = useProjectStore((s) => s.activeId);
  const lists = useListStore((s) => s.lists);
  const moveTargets = lists.filter((l) => l.project_id === activeProjectId);
  const listNameById = (id: string) =>
    lists.find((l) => l.id === id)?.name ?? null;

  const done = tasks.filter((t) => t.done).length;

  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!focusedListId) return;
    bulkCopy(focusedListId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const openOne = (id: string) => {
    if (focusedListId)
      useSelectionStore.getState().setPane(focusedListId, new Set(), id);
    useSelectionStore.getState().focus(id);
  };
  const openMoveMenu = (e: React.MouseEvent) => {
    if (moveTargets.length === 0 || !focusedListId) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({
      x: r.left,
      y: r.bottom + 4,
      items: moveTargets.map((l) => ({ id: l.id, label: l.name })),
      onPick: (id) => void bulkMove(focusedListId, id),
    });
  };

  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col">
      <div className="p-space-7 shrink-0">
        <div className="gap-space-5 flex items-center">
          <Badge
            tone="accent"
            shape="round"
            className="px-space-5 h-8 min-w-8 text-[13px] font-bold"
          >
            {tasks.length}
          </Badge>
          <div className="min-w-0 flex-1">
            <Label
              as="p"
              tone="primary"
              weight="semibold"
              className="font-display text-[16px]"
            >
              {tasks.length} tasks selected
            </Label>
            <Label as="p" tone="muted" className="text-[11.5px] tabular-nums">
              {done} done / {tasks.length}
            </Label>
          </div>
          <IconButton
            icon="close"
            iconSize={16}
            onClick={() =>
              focusedListId && useSelectionStore.getState().clear(focusedListId)
            }
            title="Clear selection"
          />
        </div>

        <div className="mt-space-6 gap-space-2 grid grid-cols-3">
          <ToolbarButton
            icon="task_alt"
            iconWeight={300}
            size="lg"
            className="justify-center"
            onClick={() => focusedListId && bulkSetDone(focusedListId, true)}
          >
            Done
          </ToolbarButton>
          <ToolbarButton
            icon="radio_button_unchecked"
            iconWeight={300}
            size="lg"
            className="justify-center"
            onClick={() => focusedListId && bulkSetDone(focusedListId, false)}
          >
            Undone
          </ToolbarButton>
          <ToolbarButton
            icon="arrow_forward"
            iconWeight={300}
            size="lg"
            className="justify-center"
            onClick={openMoveMenu}
            disabled={moveTargets.length === 0}
          >
            Move
          </ToolbarButton>
          <ToolbarButton
            icon={copied ? 'check' : 'content_copy'}
            iconWeight={300}
            size="lg"
            className="justify-center"
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </ToolbarButton>
          <ToolbarButton
            icon="delete"
            iconWeight={300}
            size="lg"
            variant="danger"
            className="col-span-2 justify-center"
            onClick={() => focusedListId && void bulkDelete(focusedListId)}
          >
            Delete
          </ToolbarButton>
        </div>
      </div>

      <div className="p-space-7 flex min-h-0 flex-1 flex-col overflow-y-auto pt-0">
        <SectionHeader label="Selected" />
        <div className="-mx-1.5 flex flex-col">
          {tasks.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group/sel rounded-field gap-space-5 px-space-4 flex h-9 items-center',
                t.id === activeId
                  ? 'bg-selection-1l dark:bg-selection-1d'
                  : 'hover:bg-wash-1l dark:hover:bg-wash-1d'
              )}
            >
              <Checkbox
                checked={t.done}
                size="sm"
                title={t.done ? 'Mark not done' : 'Mark done'}
                onClick={() => void actToggleDone(t)}
              />
              <Label
                as="button"
                onClick={() => useSelectionStore.getState().focus(t.id)}
                title={t.title}
                truncate
                tone={t.done ? 'muted' : 'primary'}
                className={cn(
                  'min-w-0 flex-1 text-left text-[13.5px]',
                  t.done && 'line-through'
                )}
              >
                {t.title}
              </Label>
              {listNameById(t.list_id) && (
                <Badge tone="outline" size="sm" className="px-space-4 shrink-0">
                  {listNameById(t.list_id)}
                </Badge>
              )}
              <IconButton
                icon="open_in_full"
                iconSize={13}
                variant="ghostStrong"
                className="opacity-0 group-hover/sel:opacity-100"
                onClick={() => openOne(t.id)}
                title="Open"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
