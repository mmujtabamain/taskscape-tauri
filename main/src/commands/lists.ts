// List-level commands: CRUD, JSON import/export, and tab navigation. The
// "modal → mutation" orchestration that used to live inline in App.
import { open, save } from '@tauri-apps/plugin-dialog';
import { api, type List } from '../api';
import { confirmModal, promptName, promptNewList } from '../lib/modal';
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
  const res = await promptNewList();
  if (!res) return;
  if (res.action === 'import') return importList();
  const list = await useListStore.getState().create(projectId, res.name);
  useLayoutStore.getState().selectList(list.id);
}

export async function renameList(list: List): Promise<void> {
  const name = await promptName({
    title: 'Rename list',
    icon: 'edit',
    initialValue: list.name,
    confirmLabel: 'Rename',
    suggestKind: 'list',
  });
  if (!name || name === list.name) return;
  await useListStore.getState().rename(list.id, name);
}

export async function deleteList(list: List): Promise<void> {
  const taskCount = useTaskStore
    .getState()
    .tasks.filter((t) => t.list_id === list.id).length;
  const ok = await confirmModal({
    danger: true,
    title: `Delete “${list.name}”?`,
    message:
      taskCount > 0
        ? `Its ${taskCount} task${taskCount === 1 ? ' is' : 's are'} deleted with it. This cannot be undone.`
        : 'The list is empty. This cannot be undone.',
    confirmLabel: 'Delete list',
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
