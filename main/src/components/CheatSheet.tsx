import { Icon } from '@taskscape/common-ui/Icon';
import { formatAccel, type HotkeyBinding } from '@taskscape/common-ui/hotkeys';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { setOverlay } from '../lib/overlays';

const SCOPE_LABEL: Record<string, string> = {
  global: 'Global',
  main: 'Main window',
  tray: 'Capture bar',
};

/** A read-only "?" cheat-sheet of every customizable shortcut, grouped by scope
 *  and rendered straight from the Rust catalog. */
export function CheatSheet({ onClose }: { onClose: () => void }) {
  const [bindings, setBindings] = useState<HotkeyBinding[]>([]);

  useEffect(() => {
    setOverlay(true);
    api.listHotkeys().then(setBindings).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      setOverlay(false);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const byScope = ['main', 'global', 'tray'].map((scope) => ({
    scope,
    items: bindings.filter((b) => b.scope === scope && b.accel),
  }));

  return (
    <div
      className="z-overlay fixed inset-0 flex items-center justify-center bg-black/30"
      onMouseDown={onClose}
    >
      <div
        className="rounded-control bg-surface-1l dark:bg-surface-1d border-edge-2l dark:border-edge-2d shadow-lift flex max-h-[76vh] w-[min(560px,92vw)] flex-col overflow-hidden border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-edge-1l dark:border-edge-1d flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
          <Icon name="keyboard" size={19} weight={300} className="text-content-2l dark:text-content-2d" />
          <span className="font-display text-content-1l dark:text-content-1d flex-1 text-[15px] font-semibold">
            Keyboard shortcuts
          </span>
          <button
            onClick={onClose}
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-7 w-7 place-items-center"
            title="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {byScope.map(
            ({ scope, items }) =>
              items.length > 0 && (
                <div key={scope} className="mb-4 last:mb-0">
                  <div className="text-content-3l dark:text-content-3d mb-1.5 text-[10.5px] font-semibold tracking-widest uppercase">
                    {SCOPE_LABEL[scope] ?? scope}
                  </div>
                  <div className="flex flex-col">
                    {items.map((b) => (
                      <div
                        key={b.id}
                        className="flex h-8 items-center justify-between gap-3"
                      >
                        <span className="text-content-2l dark:text-content-2d text-[13px]">
                          {b.label}
                        </span>
                        <kbd className="rounded-field bg-surface-3l dark:bg-surface-3d text-content-2l dark:text-content-2d border-edge-2l dark:border-edge-2d border px-1.5 py-0.5 text-[12px] tabular-nums">
                          {formatAccel(b.accel)}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              )
          )}
        </div>
        <div className="border-edge-1l dark:border-edge-1d text-content-3l dark:text-content-3d shrink-0 border-t px-4 py-2 text-[11.5px]">
          Customize any shortcut in Settings.
        </div>
      </div>
    </div>
  );
}
