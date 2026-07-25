import { HotkeyHint, IconButton, Keycap } from '@taskscape/common-ui/components';
import { parseAccel } from '@taskscape/common-ui/hotkeys';
import type { HotkeyBinding } from '../../api';
import type { HotkeyEditor } from './useHotkeyEditor';

export interface HotkeyControlProps {
  binding: HotkeyBinding;
  editor: HotkeyEditor;
}

/** The trailing control of a shortcut row: a keycap that records a new combo,
 *  plus a revert button that appears on row hover once the binding is custom. */
export function HotkeyControl({ binding, editor }: HotkeyControlProps) {
  const recording = editor.recording === binding.id;
  return (
    <span className="gap-space-2 flex items-center">
      {binding.accel !== binding.default && !recording && (
        <IconButton
          icon="restart_alt"
          iconSize={15}
          variant="ghostStrong"
          aria-label={`Reset ${binding.label} to default`}
          title="Reset to default"
          onClick={() => editor.reset(binding.id)}
          className="opacity-0 group-hover:opacity-100"
        />
      )}
      <Keycap
        recording={recording}
        onClick={() => editor.beginRecording(binding.id)}
      >
        {recording ? (
          'Type shortcut…'
        ) : binding.accel ? (
          <HotkeyHint hotkey={parseAccel(binding.accel)} tone="inherit" />
        ) : (
          <span className="italic">None</span>
        )}
      </Keycap>
    </span>
  );
}
