import { Icon } from '@taskscape/common-ui/Icon';
import { useLayoutStore } from '../../stores/layoutStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUiStore } from '../../stores/uiStore';
import { flattenVisible } from '../../stores/visibility';
import { DraftInspector } from './DraftInspector';
import { MultiInspector } from './MultiInspector';
import { TaskInspector } from './TaskInspector';

const EMPTY_IDS: Set<string> = new Set();

/** The inspector panel. Reads what to show entirely from the stores: the focused
 *  pane's selection drives the multi/single/draft/empty routing. */
export function PreviewPanel() {
  const selectedTaskId = useSelectionStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) =>
    selectedTaskId ? (s.taskById[selectedTaskId] ?? null) : null
  );
  const taskById = useTaskStore((s) => s.taskById);
  const draftListId = useUiStore((s) => s.draftListId);
  const focusedListId = useLayoutStore((s) => s.focusedListId());
  const focusSelIds =
    useSelectionStore((s) => (focusedListId ? s.byPane[focusedListId]?.ids : undefined)) ??
    EMPTY_IDS;

  // The focused pane's selection in visual order (falling back to any picked ids
  // that no longer flatten into view) — a multi-selection shows the bulk panel.
  const selectionTasks = focusedListId
    ? (() => {
        const inOrder = flattenVisible(focusedListId).filter((t) => focusSelIds.has(t.id));
        const seen = new Set(inOrder.map((t) => t.id));
        for (const id of focusSelIds)
          if (!seen.has(id) && taskById[id]) inOrder.push(taskById[id]);
        return inOrder;
      })()
    : [];

  return (
    <div className="bg-surface-1l dark:bg-surface-1d flex h-full flex-col overflow-hidden">
      {selectionTasks.length > 1 ? (
        <MultiInspector tasks={selectionTasks} />
      ) : task ? (
        <TaskInspector key={task.id} task={task} />
      ) : draftListId ? (
        <DraftInspector key={draftListId} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <Icon
            name="left_click"
            size={28}
            weight={200}
            className="text-content-3l dark:text-content-3d mb-1"
          />
          <p className="font-display text-content-2l dark:text-content-2d text-[17px] font-medium">
            No task selected
          </p>
          <p className="text-content-3l dark:text-content-3d text-[13px]">
            Select a task to inspect it
          </p>
        </div>
      )}
    </div>
  );
}
