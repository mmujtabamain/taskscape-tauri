import { Label } from '@taskscape/common-ui/components';
import type { HotkeyBinding } from '../../api';
import { HotkeyControl } from './HotkeyControl';
import type { PaneSpec, RowSpec } from './types';

const SCOPES: { id: HotkeyBinding['scope']; label: string; hint?: string }[] = [
  { id: 'global', label: 'Global', hint: 'work anywhere in macOS' },
  { id: 'main', label: 'Main window' },
  { id: 'tray', label: 'Capture bar' },
];

function bindingRow(binding: HotkeyBinding): RowSpec {
  return {
    id: `hotkey-${binding.id}`,
    title: binding.label,
    keywords: `shortcut hotkey key binding ${binding.accel}`,
    control: (ctx) => <HotkeyControl binding={binding} editor={ctx.hotkeys} />,
    footnote: (ctx) =>
      ctx.hotkeys.error?.id === binding.id ? (
        <Label as="p" tone="danger" className="text-[11px]">
          {ctx.hotkeys.error.message}
        </Label>
      ) : null,
  };
}

export const SHORTCUTS_PANE: PaneSpec = {
  id: 'shortcuts',
  label: 'Shortcuts',
  icon: 'keyboard',
  intro:
    'Click a shortcut to change it — press the new keys, Backspace to remove, Esc to cancel.',
  groups: (ctx) =>
    SCOPES.flatMap((scope) => {
      const bindings = ctx.hotkeys.bindings.filter((b) => b.scope === scope.id);
      if (bindings.length === 0) return [];
      return [
        {
          id: `scope-${scope.id}`,
          label: scope.label,
          hint: scope.hint,
          changed: bindings.some((b) => ctx.hotkeys.changedSince(b.id)),
          onDiscard: () => ctx.hotkeys.discard(bindings.map((b) => b.id)),
          rows: bindings.map(bindingRow),
        },
      ];
    }),
};
