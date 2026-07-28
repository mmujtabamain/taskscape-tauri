// List-level commands: CRUD, JSON import/export, and tab navigation. The
// "sheet → mutation" orchestration that used to live inline in App.
import { open, save } from '@tauri-apps/plugin-dialog';
import { api, type List } from '../api';
import { askConfirm, askText, openSheet } from '../lib/sheet';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';
import { useTaskStore } from '../stores/taskStore';

export async function importList(name?: string): Promise<void> {
  const projectId = useProjectStore.getState().activeId;
  if (!projectId) return;
  const path = await open({
    multiple: false,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (typeof path !== 'string') return;
  await api.importList(projectId, path, name);
  await Promise.all([
    useListStore.getState().load(),
    useTaskStore.getState().load(),
  ]);
}

export async function exportList(list: List): Promise<void> {
  const path = await save({
    defaultPath: `${list.name}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return;
  await api.exportList(list.id, path);
}

export async function createList(): Promise<void> {
  const projectId = useProjectStore.getState().activeId;
  if (!projectId) return;
  const res = await openSheet({
    glyph: 'list_alt_add',
    headline: 'New list',
    ask: { dice: 'list', placeholder: 'Name this list' },
    accept: 'Create',
    instead: { id: 'import', label: 'Import JSON…' },
  });
  if (res.action === 'instead') return importList();
  if (res.action !== 'accept') return;
  const list = await useListStore.getState().create(projectId, res.text);
  useLayoutStore.getState().selectList(list.id);
}

export async function renameList(list: List): Promise<void> {
  const name = await askText({
    glyph: 'edit',
    headline: 'Rename list',
    value: list.name,
    dice: 'list',
    accept: 'Rename',
  });
  if (!name || name === list.name) return;
  await useListStore.getState().rename(list.id, name);
}

export async function deleteList(list: List): Promise<void> {
  const taskCount = useTaskStore
    .getState()
    .tasks.filter((t) => t.list_id === list.id).length;
  const ok = await askConfirm({
    glyph: 'delete',
    tone: 'danger',
    headline: `Delete “${list.name}”?`,
    detail:
      taskCount > 0
        ? `Its ${taskCount} task${taskCount === 1 ? '' : 's'} go with it. No undo.`
        : 'The list is empty. No undo.',
    accept: 'Delete list',
  });
  if (!ok) return;
  await useListStore.getState().remove(list.id);
  // Deleting the active/split list leaves the panes pointing at a list that no
  // longer exists; fall back to a sibling so the view never lands on "No lists yet".
  const inProject = useListStore
    .getState()
    .listsInProject(useProjectStore.getState().activeId);
  useLayoutStore
    .getState()
    .reconcileLists(
      new Set(inProject.map((l) => l.id)),
      inProject[0]?.id ?? null
    );
}

/** Move focus to the next/previous tab in the active project. */
export function cycleTab(dir: -1 | 1): void {
  const listsInProject = useListStore
    .getState()
    .listsInProject(useProjectStore.getState().activeId);
  const n = listsInProject.length;
  if (n === 0) return;
  const focusedListId = useLayoutStore.getState().focusedListId();
  const idx = listsInProject.findIndex((l) => l.id === focusedListId);
  const next = listsInProject[((idx < 0 ? 0 : idx) + dir + n) % n];
  if (next) useLayoutStore.getState().selectList(next.id);
}
