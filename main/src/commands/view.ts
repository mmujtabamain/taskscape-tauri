// View/layout commands that need to read across the layout + list stores (kept
// out of layoutStore, which stays pure pane geometry with no list dependency).
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';

/** The list the split should open when toggled: the current split, else the
 *  first tab that isn't already in the left pane. */
export function splitTargetId(): string | null {
  const { splitListId, activeListId } = useLayoutStore.getState();
  const listsInProject = useListStore
    .getState()
    .listsInProject(useProjectStore.getState().activeId);
  return splitListId ?? listsInProject.find((l) => l.id !== activeListId)?.id ?? null;
}

/** Move keyboard focus to the other pane (no-op when not split). */
export function focusOtherPane(): void {
  const layout = useLayoutStore.getState();
  const { activeListId, splitListId } = layout;
  if (!splitListId) return;
  const focused = layout.focusedListId();
  layout.setPaneFocus(
    focused === splitListId ? (activeListId ?? splitListId) : splitListId
  );
}
