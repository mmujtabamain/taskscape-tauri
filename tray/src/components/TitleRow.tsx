import {
  HotkeyHint,
  TextInput,
  ToolbarButton,
} from '@taskscape/common-ui/components';
import { formatAccel } from '@taskscape/common-ui/hotkeys';
import { type RefObject } from 'react';

/** The capture bar's title field plus the (conditional) Clear affordance. */
export function TitleRow({
  title,
  onChange,
  titleRef,
  hasDraft,
  clearAccel,
  onClear,
}: {
  title: string;
  onChange: (v: string) => void;
  titleRef: RefObject<HTMLInputElement | null>;
  hasDraft: boolean;
  clearAccel: string;
  onClear: () => void;
}) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center px-3 py-2"
    >
      <TextInput
        bare
        ref={titleRef}
        autoFocus
        value={title}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Capture a task ..."
        className="text-sm"
      />

      {hasDraft && (
        <ToolbarButton
          size="xs"
          variant="well"
          icon="delete_sweep"
          iconSize={16}
          onClick={onClear}
          tabIndex={-1}
          className="shrink-0 gap-0 text-[11px] text-content-2l hover:text-content-1l dark:text-content-2d dark:hover:text-content-1d"
          title={
            clearAccel
              ? `Clear the draft (${formatAccel(clearAccel)})`
              : 'Clear the draft'
          }
        >
          <p className="px-1">Clear</p>
          <HotkeyHint accel={clearAccel} />
        </ToolbarButton>
      )}
    </div>
  );
}
