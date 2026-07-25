import {
  HotkeyHint,
  IconButton,
  Keycap,
  Label,
  SectionHeader,
} from '@taskscape/common-ui/components';
import {
  eventToAccel,
  parseAccel,
  type Accel,
} from '@taskscape/common-ui/hotkeys';
import { useCallback, useEffect, useState } from 'react';
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
      <Label as="p" tone="muted" className="text-[12px]">
        Click a shortcut to change it — press the new keys, Backspace to remove,
        Esc to cancel.
      </Label>

      {SCOPES.map((scope) => {
        const rows = bindings.filter((b) => b.scope === scope.id);
        if (rows.length === 0) return null;
        return (
          <section key={scope.id} className="space-y-1.5">
            <SectionHeader
              label={scope.label}
              hint={scope.hint}
              className="mb-0"
            />

            {rows.map((b) => (
              <div key={b.id}>
                <div className="group flex h-8 items-center justify-between">
                  <Label tone="primary" className="text-[13px]">
                    {b.label}
                  </Label>
                  <span className="gap-space-2 flex items-center">
                    {b.accel !== b.default && recording !== b.id && (
                      <IconButton
                        icon="restart_alt"
                        iconSize={15}
                        variant="ghostStrong"
                        aria-label={`Reset ${b.label} to default`}
                        title="Reset to default"
                        onClick={() => void reset(b.id)}
                        className="opacity-0 group-hover:opacity-100"
                      />
                    )}
                    <Keycap
                      recording={recording === b.id}
                      onClick={() => beginRecording(b.id)}
                    >
                      {recording === b.id ? (
                        'Type shortcut…'
                      ) : b.accel ? (
                        <HotkeyHint
                          hotkey={parseAccel(b.accel)}
                          tone="inherit"
                        />
                      ) : (
                        <span className="italic">None</span>
                      )}
                    </Keycap>
                  </span>
                </div>
                {error?.id === b.id && (
                  <Label
                    as="p"
                    tone="danger"
                    className="pb-1 text-right text-[11px]"
                  >
                    {error.message}
                  </Label>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
