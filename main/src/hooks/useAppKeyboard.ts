import { matchesEvent } from '@taskscape/common-ui/hotkeys';
import { useEffect } from 'react';
import { api } from '../api';
import { createList, cycleTab } from '../commands/lists';
import { createProject, cycleProject } from '../commands/projects';
import {
  beginTitleEdit,
  bulkDelete,
  collapseAll,
  expandAll,
  reorderSelected,
  requestDeleteTask,
  startNewTask,
} from '../commands/tasks';
import { focusOtherPane, splitTargetId } from '../commands/view';
import { paneSelectAll } from '../lib/paneSelection';
import { overlayOpen } from '../lib/overlays';
import { scrollTaskIntoView } from '../lib/scroll';
import { focusSearch } from '../lib/searchFocus';
import {
  dropOnRow as actDropOnRow,
  setTasksDone as actSetTasksDone,
  toggleDone as actToggleDone,
} from '../stores/actions';
import { useHistoryStore } from '../stores/history';
import { useHotkeyStore } from '../stores/hotkeyStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useProjectStore } from '../stores/projectStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';
import { flattenVisible } from '../stores/visibility';

/** The global keyboard map. Subscribes once; every branch reads live state from
 *  the stores and dispatches to the command layer, so there is no per-render
 *  listener churn and no captured stale state. */
export function useAppKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      const hotkeyMap = useHotkeyStore.getState().map;
      const pressed = (id: string) => matchesEvent(hotkeyMap[id] ?? '', e);
      const layout = useLayoutStore.getState();
      const focusedListId = layout.focusedListId();
      const { setPane, focus, paneSel, selectedTaskId } = useSelectionStore.getState();
      const { taskById, childrenByParent, rootsByList } = useTaskStore.getState();
      const selectedTask = selectedTaskId ? (taskById[selectedTaskId] ?? null) : null;
      const scrollTo = scrollTaskIntoView;

      if (pressed('search')) {
        e.preventDefault();
        if (focusedListId) focusSearch(focusedListId);
        return;
      }
      if (pressed('new_task')) {
        e.preventDefault();
        if (focusedListId) startNewTask(focusedListId);
        return;
      }
      if (pressed('open_settings')) {
        e.preventDefault();
        api.openSettings();
        return;
      }
      if (pressed('toggle_preview')) {
        e.preventDefault();
        layout.togglePreview();
        return;
      }
      if (pressed('prev_tab') || pressed('next_tab')) {
        e.preventDefault();
        cycleTab(pressed('prev_tab') ? -1 : 1);
        return;
      }
      if (pressed('prev_project') || pressed('next_project')) {
        e.preventDefault();
        cycleProject(pressed('prev_project') ? -1 : 1);
        return;
      }
      if (pressed('command_palette')) {
        e.preventDefault();
        useUiStore.getState().setPaletteOpen(true);
        return;
      }
      if (pressed('toggle_split')) {
        e.preventDefault();
        const t = splitTargetId();
        if (t) layout.toggleSplit(t);
        return;
      }
      if (pressed('focus_other_pane')) {
        e.preventDefault();
        focusOtherPane();
        return;
      }
      if (pressed('new_list')) {
        e.preventDefault();
        void createList();
        return;
      }
      if (pressed('new_project')) {
        e.preventDefault();
        void createProject();
        return;
      }
      if (pressed('toggle_completed')) {
        e.preventDefault();
        useSettingsStore.getState().toggleShowCompleted();
        return;
      }

      if (!typing) {
        if (pressed('undo') || pressed('redo')) {
          e.preventDefault();
          if (pressed('redo')) void useHistoryStore.getState().redo();
          else void useHistoryStore.getState().undo();
          return;
        }
        if (pressed('collapse_all')) {
          e.preventDefault();
          collapseAll();
          return;
        }
        if (pressed('expand_all')) {
          e.preventDefault();
          expandAll();
          return;
        }
        for (let i = 1; i <= 9; i++) {
          if (pressed(`switch_list_${i}`)) {
            const list = useListStore
              .getState()
              .listsInProject(useProjectStore.getState().activeId)[i - 1];
            if (list) {
              e.preventDefault();
              layout.selectList(list.id);
            }
            return;
          }
        }
        if (pressed('select_all')) {
          if (focusedListId) {
            e.preventDefault();
            paneSelectAll(focusedListId);
          }
          return;
        }
        if (pressed('move_up') || pressed('move_down')) {
          e.preventDefault();
          reorderSelected(pressed('move_up') ? -1 : 1);
          return;
        }
        if (pressed('delete_task')) {
          if (focusedListId && paneSel(focusedListId).ids.size > 0) {
            e.preventDefault();
            void bulkDelete(focusedListId);
            return;
          }
          if (selectedTask) {
            e.preventDefault();
            void requestDeleteTask(selectedTask);
          }
          return;
        }
      }

      if (typing) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const listId = focusedListId;
        if (!listId) return;
        const flat = flattenVisible(listId);
        if (flat.length === 0) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const idx = flat.findIndex((t) => t.id === selectedTaskId);
        if (e.shiftKey) {
          const nidx =
            idx < 0
              ? dir > 0
                ? 0
                : flat.length - 1
              : Math.min(Math.max(idx + dir, 0), flat.length - 1);
          const active = flat[nidx].id;
          const cur = paneSel(listId);
          const anchor = cur.anchor ?? selectedTaskId ?? active;
          const order = flat.map((t) => t.id);
          const a = order.indexOf(anchor);
          const b = order.indexOf(active);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          setPane(listId, new Set(order.slice(lo, hi + 1)), anchor);
          focus(active);
          scrollTo(active);
        } else {
          const nidx =
            idx < 0 ? (dir > 0 ? 0 : flat.length - 1) : (idx + dir + flat.length) % flat.length;
          const active = flat[nidx].id;
          setPane(listId, new Set(), active);
          focus(active);
          scrollTo(active);
        }
      } else if (e.key === 'ArrowLeft' && selectedTask) {
        const t = selectedTask;
        const kids = (childrenByParent[t.id] ?? []).length;
        if (kids > 0 && !layout.collapsed.has(t.id)) {
          e.preventDefault();
          layout.toggleCollapsed(t.id);
        } else if (t.parent_id && focusedListId) {
          e.preventDefault();
          setPane(focusedListId, new Set(), t.parent_id);
          focus(t.parent_id);
          scrollTo(t.parent_id);
        }
      } else if (e.key === 'ArrowRight' && selectedTask) {
        const t = selectedTask;
        const kids = childrenByParent[t.id] ?? [];
        if (kids.length === 0) return;
        e.preventDefault();
        if (layout.collapsed.has(t.id)) {
          layout.toggleCollapsed(t.id);
        } else if (focusedListId) {
          const first = kids[0].id;
          setPane(focusedListId, new Set(), first);
          focus(first);
          scrollTo(first);
        }
      } else if (e.key === 'Tab' && selectedTask) {
        e.preventDefault();
        const t = selectedTask;
        if (e.shiftKey) {
          // Outdent: become a sibling of the parent, just after it.
          const parent = t.parent_id ? taskById[t.parent_id] : null;
          if (parent) void actDropOnRow(t.id, parent, 'after');
        } else {
          // Indent: nest under the previous visible sibling.
          const sibs = (t.parent_id ? childrenByParent[t.parent_id] : rootsByList[t.list_id]) ?? [];
          const prev = sibs[sibs.findIndex((s) => s.id === t.id) - 1];
          if (prev) void actDropOnRow(t.id, prev, 'nest');
        }
      } else if (e.key === ' ') {
        // Space toggles the whole selection when one is live (flip to all-done, or
        // all-undone when they already are), else the single previewed task.
        const selIds = focusedListId ? [...paneSel(focusedListId).ids] : [];
        if (selIds.length > 0) {
          e.preventDefault();
          const allDone = selIds.every((id) => taskById[id]?.done);
          void actSetTasksDone(selIds, !allDone);
        } else if (selectedTask) {
          e.preventDefault();
          void actToggleDone(selectedTask);
        }
      } else if ((e.key === 'F2' || e.key === 'Enter') && selectedTask) {
        e.preventDefault();
        beginTitleEdit(selectedTask.id);
      } else if (e.key === 'Escape') {
        if (overlayOpen()) return;
        if (useUiStore.getState().trashOpen) {
          useUiStore.getState().setTrashOpen(false);
          return;
        }
        if (focusedListId && paneSel(focusedListId).ids.size > 0)
          useSelectionStore.getState().clear(focusedListId);
        else focus(null);
      } else if (e.key === '?' && !overlayOpen()) {
        e.preventDefault();
        useUiStore.getState().setCheatOpen(true);
      } else if (
        e.key.length === 1 &&
        !e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !overlayOpen()
      ) {
        if (focusedListId) {
          e.preventDefault();
          focusSearch(focusedListId, e.key);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
