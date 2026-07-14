import { bindingsToMap } from '@taskscape/common-ui/hotkeys';
import { useEvent } from '@taskscape/common-ui/useEvent';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { api } from '../api';

/** The effective hotkey combos by command id. Rust owns the catalog; this mirrors
 *  it, reloading on the initial mount and whenever the settings window reports
 *  `hotkeys-changed`. `reload` is exposed so the reveal handler can refresh too. */
export function useHotkeyMap(): {
  hotkeyMap: Record<string, string>;
  reload: () => void;
} {
  const [hotkeyMap, setMap] = useState<Record<string, string>>({});
  const reload = useEvent(() => {
    api
      .listHotkeys()
      .then((bindings) => setMap(bindingsToMap(bindings)))
      .catch(() => {});
  });

  useEffect(() => {
    reload();
    const un = listen('hotkeys-changed', () => reload());
    return () => {
      un.then((f) => f());
    };
  }, [reload]);

  return { hotkeyMap, reload };
}
