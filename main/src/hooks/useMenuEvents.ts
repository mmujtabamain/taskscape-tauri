import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { exportList, importList } from '../commands/lists';
import { useLayoutStore } from '../stores/layoutStore';
import { useListStore } from '../stores/listStore';
import { useViewStore, type PaneView } from '../stores/viewStore';

/** Wire the outside-window events the shell responds to: the macOS "List" menu's
 *  import/export items, and the standalone filter overlay window streaming an
 *  edited pane view back. */
export function useMenuEvents(): void {
  useEffect(() => {
    const subs = [
      listen('menu:import-list', () => void importList()),
      listen('menu:export-list', () => {
        const id = useLayoutStore.getState().activeListId;
        const list = useListStore.getState().lists.find((l) => l.id === id);
        if (list) void exportList(list);
      }),
      listen<{ paneId: string; view: PaneView }>('overlay-apply', (e) =>
        useViewStore.getState().set(e.payload.paneId, e.payload.view)
      ),
    ];
    return () => subs.forEach((s) => s.then((f) => f()));
  }, []);
}
