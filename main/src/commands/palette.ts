// Builds the ⌘K command catalog from live store state. Invoked once each time
// the palette opens (cheap), so it always reflects the current project/lists.
import { api } from '../api';
import type { PaletteCommand } from '../components/CommandPalette';
import { focusSearch } from '../lib/searchFocus';
import { useHistoryStore } from '../stores/history';
import { useHotkeyStore } from '../stores/hotkeyStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';
import { createList } from './lists';
import { createProject, selectProject } from './projects';
import {
  collapseAll,
  expandAll,
  requestDeleteTask,
  startNewTask,
} from './tasks';
import { splitTargetId } from './view';

export function buildCommands(): PaletteCommand[] {
  const layout = useLayoutStore.getState();
  const accel = (id: string) => useHotkeyStore.getState().map[id];
  const focusedListId = layout.focusedListId();
  const listsInProject = useListStore
    .getState()
    .listsInProject(useProjectStore.getState().activeId);
  const projects = useProjectStore.getState().projects;
  const { selectedTaskId } = useSelectionStore.getState();
  const selectedTask = selectedTaskId
    ? useTaskStore.getState().taskById[selectedTaskId]
    : null;

  const cmds: PaletteCommand[] = [
    {
      id: 'toggle_preview',
      group: 'View',
      label: 'Toggle preview',
      icon: 'right_panel_open',
      accel: accel('toggle_preview'),
      run: () => layout.togglePreview(),
    },
    {
      id: 'toggle_split',
      group: 'View',
      label: 'Toggle split view',
      icon: 'vertical_split',
      accel: accel('toggle_split'),
      run: () => {
        const t = splitTargetId();
        if (t) layout.toggleSplit(t);
      },
    },
    {
      id: 'swap_panes',
      group: 'View',
      label: 'Swap panes',
      icon: 'swap_horiz',
      run: () => layout.swapPanes(),
    },
    {
      id: 'toggle_completed',
      group: 'View',
      label: 'Show / hide completed',
      icon: 'visibility',
      accel: accel('toggle_completed'),
      run: () => useSettingsStore.getState().toggleShowCompleted(),
    },
    {
      id: 'collapse_all',
      group: 'View',
      label: 'Collapse all',
      icon: 'unfold_less',
      accel: accel('collapse_all'),
      run: collapseAll,
    },
    {
      id: 'expand_all',
      group: 'View',
      label: 'Expand all',
      icon: 'unfold_more',
      accel: accel('expand_all'),
      run: expandAll,
    },
    {
      id: 'new_task',
      group: 'Task',
      label: 'New task',
      icon: 'add',
      accel: accel('new_task'),
      run: () => {
        if (focusedListId) startNewTask(focusedListId);
      },
    },
    {
      id: 'search',
      group: 'Task',
      label: 'Search this list',
      icon: 'search',
      accel: accel('search'),
      run: () => {
        if (focusedListId) focusSearch(focusedListId);
      },
    },
    {
      id: 'undo',
      group: 'Task',
      label: 'Undo',
      icon: 'undo',
      accel: accel('undo'),
      run: () => void useHistoryStore.getState().undo(),
    },
    {
      id: 'redo',
      group: 'Task',
      label: 'Redo',
      icon: 'redo',
      accel: accel('redo'),
      run: () => void useHistoryStore.getState().redo(),
    },
    {
      id: 'new_list',
      group: 'Manage',
      label: 'New list',
      icon: 'playlist_add',
      accel: accel('new_list'),
      run: createList,
    },
    {
      id: 'new_project',
      group: 'Manage',
      label: 'New project',
      icon: 'create_new_folder',
      accel: accel('new_project'),
      run: createProject,
    },
    {
      id: 'trash',
      group: 'Manage',
      label: 'Open Trash',
      icon: 'delete',
      run: () => useUiStore.getState().setTrashOpen(true),
    },
    {
      id: 'open_settings',
      group: 'Manage',
      label: 'Settings',
      icon: 'settings',
      accel: accel('open_settings'),
      run: () => api.openSettings(),
    },
  ];
  if (selectedTask)
    cmds.push({
      id: 'delete_sel',
      group: 'Task',
      label: `Delete “${selectedTask.title}”`,
      icon: 'delete',
      run: () => void requestDeleteTask(selectedTask),
    });
  for (const l of listsInProject)
    cmds.push({
      id: `go-list-${l.id}`,
      group: 'Go to list',
      label: l.name,
      icon: 'list',
      run: () => layout.selectList(l.id),
    });
  for (const p of projects)
    cmds.push({
      id: `go-proj-${p.id}`,
      group: 'Go to project',
      label: p.name,
      icon: 'folder',
      run: () => selectProject(p.id),
    });
  return cmds;
}
