// A tiny module-level payload for task drag-and-drop. WKWebView doesn't reliably
// carry a second custom MIME type through a drag, so a multi-task set travels
// here instead of on the DataTransfer — set on dragstart, read on drop, cleared
// on dragend. The primary id still rides on `application/x-task` so drop targets
// can detect a task drag (in dragover, DataTransfer values are unreadable) and
// so single drags keep working with no store at all.
let draggedIds: string[] | null = null;

/** Record the ids this drag carries: the selection's forest roots for a
 *  multi-drag, or a single id. */
export function beginTaskDrag(ids: string[]): void {
  draggedIds = ids.length > 0 ? ids : null;
}

export function endTaskDrag(): void {
  draggedIds = null;
}

/** The ids a drop should act on: the tracked set for the active task drag, else
 *  the single id on the DataTransfer. Empty when it isn't a task drag at all
 *  (e.g. a list-tab reorder), so unrelated drops are never misread. */
export function readDroppedIds(e: { dataTransfer: DataTransfer }): string[] {
  const single = e.dataTransfer.getData('application/x-task');
  if (!single) return [];
  return draggedIds && draggedIds.length > 0 ? draggedIds : [single];
}
