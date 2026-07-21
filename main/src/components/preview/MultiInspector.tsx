import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
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
import { DoneCheckbox } from './DoneCheckbox';
import { SectionHeader } from './SectionHeader';

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
  const listNameById = (id: string) => lists.find((l) => l.id === id)?.name ?? null;

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

  const act =
    'rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d flex h-8 items-center justify-center gap-1.5 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-4">
        <div className="flex items-center gap-2.5">
          <span className="bg-accent-500l dark:bg-accent-500d text-on-accent grid h-8 min-w-8 place-items-center rounded-full px-2 text-[13px] font-bold tabular-nums">
            {tasks.length}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-content-1l dark:text-content-1d text-[16px] font-semibold">
              {tasks.length} tasks selected
            </p>
            <p className="text-content-3l dark:text-content-3d text-[11.5px] tabular-nums">
              {done} done / {tasks.length}
            </p>
          </div>
          <button
            onClick={() => focusedListId && useSelectionStore.getState().clear(focusedListId)}
            title="Clear selection"
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1">
          <button
            className={act}
            onClick={() => focusedListId && bulkSetDone(focusedListId, true)}
          >
            <Icon name="task_alt" size={15} weight={300} />
            Done
          </button>
          <button
            className={act}
            onClick={() => focusedListId && bulkSetDone(focusedListId, false)}
          >
            <Icon name="radio_button_unchecked" size={15} weight={300} />
            Undone
          </button>
          <button className={act} onClick={openMoveMenu} disabled={moveTargets.length === 0}>
            <Icon name="arrow_forward" size={15} weight={300} />
            Move
          </button>
          <button className={act} onClick={copy}>
            <Icon name={copied ? 'check' : 'content_copy'} size={15} weight={300} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            className={cn(act, 'col-span-2 hover:text-danger-500l dark:hover:text-danger-500d')}
            onClick={() => focusedListId && void bulkDelete(focusedListId)}
          >
            <Icon name="delete" size={15} weight={300} />
            Delete
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-0">
        <SectionHeader label="Selected" />
        <div className="-mx-1.5 flex flex-col">
          {tasks.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group/sel rounded-field flex h-9 items-center gap-2.5 px-1.5',
                t.id === activeId
                  ? 'bg-selection-1l dark:bg-selection-1d'
                  : 'hover:bg-wash-1l dark:hover:bg-wash-1d'
              )}
            >
              <DoneCheckbox done={t.done} size={14} onToggle={() => void actToggleDone(t)} />
              <button
                onClick={() => useSelectionStore.getState().focus(t.id)}
                title={t.title}
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-[13.5px]',
                  t.done
                    ? 'text-content-3l dark:text-content-3d line-through'
                    : 'text-content-1l dark:text-content-1d'
                )}
              >
                {t.title}
              </button>
              {listNameById(t.list_id) && (
                <span className="rounded-field border-edge-2l dark:border-edge-2d text-content-3l dark:text-content-3d shrink-0 border px-1.5 text-[10.5px] font-semibold">
                  {listNameById(t.list_id)}
                </span>
              )}
              <button
                onClick={() => openOne(t.id)}
                title="Open"
                className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center opacity-0 transition-opacity group-hover/sel:opacity-100"
              >
                <Icon name="open_in_full" size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
