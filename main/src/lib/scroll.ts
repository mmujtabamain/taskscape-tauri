/** Bring a task row into view by its id. Used by keyboard nav, search cycling,
 *  and the command palette — the one place that reaches into the DOM for a row
 *  (rows are virtual-free but numerous, so a ref map would be heavier). */
export function scrollTaskIntoView(id: string): void {
  document
    .querySelector(`[data-task-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}
