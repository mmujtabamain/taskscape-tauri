import { cn } from '@taskscape/common-ui/cn';
import { Icon } from '@taskscape/common-ui/Icon';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setOverlay } from '../lib/overlays';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Group heading, e.g. "Navigate", "Task", "View". */
  group: string;
  /** Effective accelerator string (canonical), shown as a glyph hint. */
  accel?: string;
  icon?: string;
  run: () => void;
}

/** ⌘K command palette: fuzzy-run any command or jump to any list/project. A thin
 *  overlay App feeds a command builder; this handles filtering + keyboard nav.
 *  The builder is invoked once on open (not during App's render). */
export function CommandPalette({
  getCommands,
  onClose,
}: {
  getCommands: () => PaletteCommand[];
  onClose: () => void;
}) {
  const [commands] = useState(getCommands);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOverlay(true);
    inputRef.current?.focus();
    return () => setOverlay(false);
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands
      .map((c) => ({ c, i: c.label.toLowerCase().indexOf(needle) }))
      .filter((x) => x.i >= 0)
      // Earlier matches rank higher; stable within a rank.
      .sort((a, b) => a.i - b.i)
      .map((x) => x.c);
  }, [q, commands]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  return (
    <div
      className="z-overlay fixed inset-0 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        className="rounded-control bg-surface-1l dark:bg-surface-1d border-edge-2l dark:border-edge-2d shadow-lift flex max-h-[60vh] w-[min(560px,92vw)] flex-col overflow-hidden border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-edge-1l dark:border-edge-1d flex h-12 shrink-0 items-center gap-2.5 border-b px-3.5">
          <Icon
            name="bolt"
            size={18}
            weight={300}
            className="text-content-3l dark:text-content-3d shrink-0"
          />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Run a command or jump to…"
            className="text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d w-full bg-transparent text-[14px] outline-none"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(active);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {results.length === 0 && (
            <p className="text-content-3l dark:text-content-3d px-4 py-6 text-center text-[13px]">
              No matching commands
            </p>
          )}
          {results.map((cmd, i) => {
            const prevGroup = results[i - 1]?.group;
            return (
              <div key={cmd.id}>
                {cmd.group !== prevGroup && (
                  <div className="text-content-3l dark:text-content-3d mt-1.5 mb-0.5 px-3.5 text-[10.5px] font-semibold tracking-widest uppercase">
                    {cmd.group}
                  </div>
                )}
                <button
                  data-idx={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[13.5px]',
                    i === active
                      ? 'bg-selection-1l dark:bg-selection-1d text-content-1l dark:text-content-1d'
                      : 'text-content-2l dark:text-content-2d'
                  )}
                >
                  <Icon
                    name={cmd.icon ?? 'chevron_right'}
                    size={16}
                    weight={300}
                    className="text-content-3l dark:text-content-3d shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                  {cmd.accel && (
                    <span className="text-content-3l dark:text-content-3d shrink-0 text-[12px] tabular-nums">
                      {formatAccel(cmd.accel)}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
