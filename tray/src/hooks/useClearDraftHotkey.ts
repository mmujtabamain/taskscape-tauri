import { matchesEvent } from '@taskscape/common-ui/hotkeys';
import { useEffect } from 'react';

/** The clear-draft combo (⌘⇧⌫ by default, user-customizable) works from anywhere
 *  in the bar. A capture-phase listener fires before the title field's and the
 *  notes editor's own key handling (the editor stops React propagation), so it
 *  works in either field. */
export function useClearDraftHotkey(clearAccel: string, clearDraft: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesEvent(clearAccel, e)) {
        e.preventDefault();
        e.stopPropagation();
        clearDraft();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [clearAccel, clearDraft]);
}
