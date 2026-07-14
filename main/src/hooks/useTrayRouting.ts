import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { attachShotHere, startNewTask } from '../commands/tasks';
import { useLayoutStore } from '../stores/layoutStore';

/** The tray forwards ⌘Enter / ⌘⇧Enter here when the main window is frontmost.
 *  Handlers read live layout/selection via the stores, so the listeners can be
 *  registered once with no stale-closure ref juggling. */
export function useTrayRouting(): void {
  useEffect(() => {
    const subs = [
      listen('new-task', () => {
        const id = useLayoutStore.getState().focusedListId();
        if (id) startNewTask(id);
      }),
      listen('attach-screenshot', () => void attachShotHere()),
    ];
    return () => subs.forEach((s) => s.then((f) => f()));
  }, []);
}
