import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@taskscape/common-ui/Icon';
import { eventToAccel, formatAccel } from '@taskscape/common-ui/hotkeys';
import { api, type HotkeyBinding } from '../api';

const SCOPES: { id: HotkeyBinding['scope']; label: string; hint?: string }[] = [
  { id: 'global', label: 'Global', hint: 'work anywhere in macOS' },
  { id: 'main', label: 'Main window' },
  { id: 'tray', label: 'Capture bar' },
];

export function ShortcutsPane() {
  const [bindings, setBindings] = useState<HotkeyBinding[]>([]);
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null
  );

  const load = useCallback(
    () =>
      api
        .listHotkeys()
        .then(setBindings)
        .catch(() => {}),
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  const assign = useCallback(
    async (id: string, accel: string) => {
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
  // Backspace/Delete unbinds. Capture phase + stopPropagation keeps the
  // window's own Escape-to-close (and any app shortcut) out of the recording.
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

  async function reset(id: string) {
    setError(null);
    await api.resetHotkey(id).catch(() => {});
    await load();
  }

  function beginRecording(id: string) {
    setError(null);
    setRecording((cur) => (cur === id ? null : id));
  }

  return (
    <div className="space-y-5">
      <p className="text-content-3l dark:text-content-3d text-[12px]">
        Click a shortcut to change it — press the new keys, Backspace to
        remove, Esc to cancel.
      </p>

      {SCOPES.map((scope) => {
        const rows = bindings.filter((b) => b.scope === scope.id);
        if (rows.length === 0) return null;
        return (
          <section key={scope.id} className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="text-content-3l dark:text-content-3d text-[11px] font-semibold tracking-widest uppercase">
                {scope.label}
              </span>
              {scope.hint && (
                <span className="text-content-3l dark:text-content-3d text-[11px]">
                  {scope.hint}
                </span>
              )}
              <span className="border-edge-1l dark:border-edge-1d flex-1 border-t" />
            </div>

            {rows.map((b) => (
              <div key={b.id}>
                <div className="group flex h-8 items-center justify-between">
                  <span className="text-content-1l dark:text-content-1d text-[13px]">
                    {b.label}
                  </span>
                  <span className="flex items-center gap-1">
                    {b.accel !== b.default && recording !== b.id && (
                      <button
                        type="button"
                        aria-label={`Reset ${b.label} to default`}
                        title="Reset to default"
                        onClick={() => void reset(b.id)}
                        className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d flex h-6 w-6 items-center justify-center opacity-0 group-hover:opacity-100"
                      >
                        <Icon name="restart_alt" size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => beginRecording(b.id)}
                      className={`rounded-field inline-flex h-6 min-w-14 items-center justify-center border px-2 font-sans text-[11px] tabular-nums ${
                        recording === b.id
                          ? 'border-accent-500l dark:border-accent-500d text-accent-500l dark:text-accent-500d bg-surface-0l dark:bg-surface-0d'
                          : 'border-edge-2l dark:border-edge-2d bg-surface-0l dark:bg-surface-0d text-content-2l dark:text-content-2d hover:border-edge-3l dark:hover:border-edge-3d hover:text-content-1l dark:hover:text-content-1d'
                      }`}
                    >
                      {recording === b.id ? (
                        'Type shortcut…'
                      ) : b.accel ? (
                        formatAccel(b.accel)
                      ) : (
                        <span className="italic">None</span>
                      )}
                    </button>
                  </span>
                </div>
                {error?.id === b.id && (
                  <p className="pb-1 text-right text-[11px] text-red-500 dark:text-red-400">
                    {error.message}
                  </p>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
