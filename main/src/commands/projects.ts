// Project-level commands: the "sheet → store mutation" flows that used to
// live inline in App. Components call these directly; each reads live state from
// the stores, so there is nothing to wire up.
import type { Project } from '../api';
import { askConfirm, askText } from '../lib/sheet';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useTaskStore } from '../stores/taskStore';

export async function createProject(): Promise<void> {
  const name = await askText({
    glyph: 'create_new_folder',
    headline: 'New project',
    placeholder: 'Name this project',
    dice: 'project',
    accept: 'Create',
  });
  if (!name) return;
  await useProjectStore.getState().create(name);
}

export async function renameProject(project: Project): Promise<void> {
  const name = await askText({
    glyph: 'edit',
    headline: 'Rename project',
    value: project.name,
    accept: 'Rename',
  });
  if (!name || name === project.name) return;
  await useProjectStore.getState().rename(project.id, name);
}

export async function deleteProject(project: Project): Promise<void> {
  const listIds = useListStore
    .getState()
    .lists.filter((l) => l.project_id === project.id)
    .map((l) => l.id);
  const taskCount = useTaskStore
    .getState()
    .tasks.filter((t) => listIds.includes(t.list_id)).length;
  const ok = await askConfirm({
    glyph: 'delete',
    tone: 'danger',
    headline: `Delete “${project.name}”?`,
    detail: `Its ${listIds.length} list${listIds.length === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'} go with it. No undo.`,
    accept: 'Delete project',
  });
  if (!ok) return;
  await useProjectStore.getState().remove(project.id);
}

/** Switch projects: reset both panes to the project's first list and drop the
 *  single-task preview. */
export function selectProject(id: string): void {
  useProjectStore.getState().setActive(id);
  const first =
    useListStore.getState().lists.find((l) => l.project_id === id) ?? null;
  useLayoutStore.getState().resetForProject(first?.id ?? null);
  useSelectionStore.getState().focus(null);
}

export function cycleProject(dir: -1 | 1): void {
  const { projects, activeId } = useProjectStore.getState();
  const n = projects.length;
  if (n === 0) return;
  const idx = projects.findIndex((p) => p.id === activeId);
  const next = projects[((idx < 0 ? 0 : idx) + dir + n) % n];
  if (next && next.id !== activeId) selectProject(next.id);
}
