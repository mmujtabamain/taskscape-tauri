// Pure derivations over the flat task list — the tree/index/count shapes the UI
// reads. Lifted verbatim from App's old useMemo block so the store is the single
// place this is computed (once per task-list change, not per render).
import type { Task } from '../api';

export const effSort = (t: Task) => t.sort_order || t.created_at;

export interface TaskDerived {
  taskById: Record<string, Task>;
  childrenByParent: Record<string, Task[]>;
  rootsByList: Record<string, Task[]>;
  /** Undone root-level tasks per list — the tab badge count. */
  counts: Record<string, number>;
  /** Parents with an undone descendant (kept visible under "hide completed"). */
  hasPendingDesc: Set<string>;
  /** Parents with a done descendant (kept visible in the "completed" filter). */
  hasDoneDesc: Set<string>;
}

export function deriveTasks(tasks: Task[]): TaskDerived {
  const taskById: Record<string, Task> = {};
  for (const t of tasks) taskById[t.id] = t;

  const childrenByParent: Record<string, Task[]> = {};
  const rootsByList: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (t.parent_id) (childrenByParent[t.parent_id] ??= []).push(t);
    else (rootsByList[t.list_id] ??= []).push(t);
  }
  for (const k in childrenByParent)
    childrenByParent[k].sort((a, b) => effSort(a) - effSort(b));
  for (const k in rootsByList)
    rootsByList[k].sort((a, b) => effSort(a) - effSort(b));

  const counts: Record<string, number> = {};
  for (const t of tasks)
    if (t.parent_id == null && !t.done)
      counts[t.list_id] = (counts[t.list_id] ?? 0) + 1;

  const hasPendingDesc = new Set<string>();
  const hasDoneDesc = new Set<string>();
  for (const t of tasks) {
    const bucket = t.done ? hasDoneDesc : hasPendingDesc;
    let p = t.parent_id;
    while (p && !bucket.has(p)) {
      bucket.add(p);
      p = taskById[p]?.parent_id ?? null;
    }
  }

  return {
    taskById,
    childrenByParent,
    rootsByList,
    counts,
    hasPendingDesc,
    hasDoneDesc,
  };
}
