// Pane-scoped selection interactions: focus the pane, then update the selection
// store against the pane's live visual order. Shared by TaskRow (click/toggle)
// and the keyboard handler (select-all), so the "focus then select" pairing
// lives in one place.
import { useLayoutStore } from '../stores/layoutStore';
import { useSelectionStore, type ClickMods } from '../stores/selectionStore';
import { flattenVisible } from '../stores/visibility';

const visualOrder = (listId: string) => flattenVisible(listId).map((t) => t.id);

/** A row was clicked: focus the pane, then apply plain / ⌘ / ⇧ semantics. */
export function paneRowClick(
  listId: string,
  id: string,
  mods: ClickMods
): void {
  useLayoutStore.getState().setPaneFocus(listId);
  useSelectionStore.getState().rowClick(listId, id, mods, visualOrder(listId));
}

export function paneToggleSelect(listId: string, id: string): void {
  useLayoutStore.getState().setPaneFocus(listId);
  useSelectionStore.getState().toggle(listId, id);
}

export function paneSelectAll(listId: string): void {
  useLayoutStore.getState().setPaneFocus(listId);
  useSelectionStore.getState().selectAll(listId, visualOrder(listId));
}
