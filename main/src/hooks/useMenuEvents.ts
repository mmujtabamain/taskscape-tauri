import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { exportList, importList } from '../commands/lists';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';

/** Wire the macOS "List" menu's import/export items back to the shell (they need
 *  the dialog + store, so the backend forwards the click as an event). */
export function useMenuEvents(): void {
  useEffect(() => {
    const subs = [
      listen('menu:import-list', () => void importList()),
      listen('menu:export-list', () => {
        const id = useLayoutStore.getState().activeListId;
        const list = useListStore.getState().lists.find((l) => l.id === id);
        if (list) void exportList(list);
      }),
    ];
    return () => subs.forEach((s) => s.then((f) => f()));
  }, []);
}
