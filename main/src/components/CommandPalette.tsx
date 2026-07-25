import { Icon } from '@taskscape/common-ui/Icon';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import {
  Backdrop,
  Label,
  MenuItem,
  Surface,
  TextInput,
} from '@taskscape/common-ui/components';
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
    <Backdrop
      dim="30"
      className="flex items-start justify-center pt-[12vh]"
      onMouseDown={onClose}
    >
      <Surface
        elevation="lift"
        surface={1}
        radius="control"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[60vh] w-[min(560px,92vw)] flex-col overflow-hidden"
      >
        <div className="border-edge-1l dark:border-edge-1d flex h-11 shrink-0 items-center gap-space-5 border-b px-space-6">
          <Icon
            name="bolt"
            size={18}
            weight={300}
            className="text-content-3l dark:text-content-3d shrink-0"
          />
          <TextInput
            bare
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Run a command or jump to…"
            className="w-full text-[14px]"
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
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-space-3">
          {results.length === 0 && (
            <Label as="p" tone="muted" className="px-space-7 py-6 text-center text-[13px]">
              No matching commands
            </Label>
          )}
          {results.map((cmd, i) => {
            const prevGroup = results[i - 1]?.group;
            return (
              <div key={cmd.id}>
                {cmd.group !== prevGroup && (
                  <Label
                    as="div"
                    tone="muted"
                    weight="semibold"
                    className="mt-space-3 mb-space-1 px-space-6 text-[10.5px] tracking-widest uppercase"
                  >
                    {cmd.group}
                  </Label>
                )}
                <MenuItem
                  data-idx={i}
                  active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAt(i)}
                  leading={
                    <Icon name={cmd.icon ?? 'chevron_right'} size={16} weight={300} />
                  }
                  trailing={
                    cmd.accel && (
                      <span className="text-[12px] tabular-nums">
                        {formatAccel(cmd.accel)}
                      </span>
                    )
                  }
                >
                  {cmd.label}
                </MenuItem>
              </div>
            );
          })}
        </div>
      </Surface>
    </Backdrop>
  );
}
