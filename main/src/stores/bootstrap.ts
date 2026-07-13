// One place that wires the stores to the outside world: the initial load, the
// Tauri events that reload data (refresh / settings-changed / hotkeys-changed),
// and selection-pruning whenever the task list changes. App calls
// `startBootstrap()` once and cleans up on unmount.
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import { useHotkeyStore } from './hotkeyStore';
import { useLayoutStore } from './layoutStore';
import { useListStore } from './listStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useSettingsStore } from './settingsStore';
import { useTaskStore } from './taskStore';

/** Ensure the two panes point at lists that exist in the active project, keeping
 *  the user's current lists when still valid and otherwise restoring the
 *  persisted / first list. */
async function reconcileLayout() {
  const activeId = useProjectStore.getState().activeId;
  const inProject = useListStore.getState().listsInProject(activeId);
  const valid = (id: string | null) => !!id && inProject.some((l) => l.id === id);

  const layout = useLayoutStore.getState();
  let activeListId = layout.activeListId;
  if (!valid(activeListId)) {
    const persisted = await api.getSetting('last_active_list');
    activeListId = valid(persisted) ? persisted : (inProject[0]?.id ?? null);
  }
  const splitListId =
    valid(layout.splitListId) && layout.splitListId !== activeListId
      ? layout.splitListId
      : null;
  useLayoutStore.setState({ activeListId, splitListId });
}

/** Reload the domain data (projects → lists → tasks) as one unit. */
async function reloadData() {
  await useProjectStore.getState().load();
  await Promise.all([
    useListStore.getState().load(),
    useTaskStore.getState().load(),
  ]);
  await reconcileLayout();
}

export async function initialLoad() {
  await reloadData();
  await Promise.all([
    useSettingsStore.getState().load(),
    useHotkeyStore.getState().load(),
  ]);
}

export function startBootstrap(): () => void {
  // Whenever the task list changes (load, mutation, or a tray-driven refresh),
  // drop selected ids that no longer exist.
  const unsubTasks = useTaskStore.subscribe((state, prev) => {
    if (state.tasks !== prev.tasks)
      useSelectionStore
        .getState()
        .pruneToAlive(new Set(state.tasks.map((t) => t.id)));
  });

  const refresh = listen('refresh', () => void reloadData());
  const settings = listen('settings-changed', () => {
    void useSettingsStore.getState().load();
    void reloadData();
  });
  const hotkeys = listen('hotkeys-changed', () => void useHotkeyStore.getState().load());

  return () => {
    unsubTasks();
    refresh.then((fn) => fn());
    settings.then((fn) => fn());
    hotkeys.then((fn) => fn());
  };
}
