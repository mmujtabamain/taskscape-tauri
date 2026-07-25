import {
  bindingsToMap,
  eventToAccel,
  type Accel,
} from '@taskscape/common-ui/hotkeys';
import { useCallback, useEffect, useState } from 'react';
import { api, type HotkeyBinding } from '../../api';

export interface HotkeyEditor {
  bindings: HotkeyBinding[];
  /** Id of the binding currently capturing keys, if any. */
  recording: string | null;
  /** A rejected rebind (a conflict), tied to the binding it came from. */
  error: { id: string; message: string } | null;
  beginRecording: (id: string) => void;
  /** Back to the shipped default. */
  reset: (id: string) => void;
  resetAll: () => void;
  /** This binding differs from what the window opened with. */
  changedSince: (id: string) => boolean;
  /** Any binding does. */
  changed: boolean;
  /** Put the given bindings back to what they were when the window opened. */
  discard: (ids: string[]) => void;
  discardAll: () => void;
}

/** Owns the hotkey catalog and the record-a-combo interaction. Lives in the
 *  window shell, not the Shortcuts pane, so search can index every binding
 *  while that pane is off screen. */
export function useHotkeyEditor(): HotkeyEditor {
  const [bindings, setBindings] = useState<HotkeyBinding[]>([]);
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null
  );

  // The accels the window opened with — kept from the first load, so the soft
  // reset can undo this session's rebinds (the per-row revert restores the
  // shipped default instead, which is a different thing).
  const [opened, setOpened] = useState<Record<string, Accel> | null>(null);

  const load = useCallback(
    () =>
      api
        .listHotkeys()
        .then((list) => {
          setOpened((prev) => prev ?? bindingsToMap(list));
          setBindings(list);
        })
        .catch(() => {}),
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  const assign = useCallback(
    async (id: string, accel: Accel) => {
      setRecording(null);
      setError(null);
      try {
        await api.setHotkey(id, accel);
        await load();
      } catch (e) {
        setError({ id, message: String(e) });
      }
    },
    [load]
  );

  // While recording, the next keydown is the new combo: Escape cancels, a bare
  // Backspace/Delete unbinds. Capture phase + stopPropagation keeps the window's
  // own shortcuts (Escape to close, ⌘F to search) out of the recording.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (bare && (e.key === 'Backspace' || e.key === 'Delete')) {
        void assign(recording, '');
        return;
      }
      const accel = eventToAccel(e);
      if (accel) void assign(recording, accel);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true });
  }, [recording, assign]);

  // Sequential on purpose: the backend rejects conflicts, so restoring defaults
  // one at a time can't race a half-applied pair against itself.
  const resetIds = useCallback(
    async (ids: string[]) => {
      setError(null);
      for (const id of ids) await api.resetHotkey(id).catch(() => {});
      await load();
    },
    [load]
  );

  // Same sequencing rationale as resetIds: one at a time, so a swapped pair can't
  // be rejected as a conflict with its own half-applied state.
  const applyAccels = useCallback(
    async (entries: [string, Accel][]) => {
      setError(null);
      for (const [id, accel] of entries)
        await api.setHotkey(id, accel).catch(() => {});
      await load();
    },
    [load]
  );

  const beginRecording = useCallback((id: string) => {
    setError(null);
    setRecording((cur) => (cur === id ? null : id));
  }, []);

  const changedSince = (id: string) => {
    const binding = bindings.find((b) => b.id === id);
    return (
      opened != null &&
      binding != null &&
      id in opened &&
      binding.accel !== opened[id]
    );
  };

  const restore = (ids: string[]) =>
    void applyAccels(
      opened
        ? ids.filter((id) => changedSince(id)).map((id) => [id, opened[id]])
        : []
    );

  return {
    bindings,
    recording,
    error,
    beginRecording,
    reset: (id) => void resetIds([id]),
    resetAll: () => void resetIds(bindings.map((b) => b.id)),
    changedSince,
    changed: bindings.some((b) => changedSince(b.id)),
    discard: restore,
    discardAll: () => restore(bindings.map((b) => b.id)),
  };
}
