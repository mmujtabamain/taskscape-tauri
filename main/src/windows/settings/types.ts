// Panes are declarative specs, not components: a pane is a pure function from
// the window's state (SettingsCtx) to a list of groups of rows. That's what lets
// one renderer draw a pane and the search field index every row in every pane —
// including the dynamic hotkey rows — without either duplicating the other.
import type { SettingRowLayout } from '@taskscape/common-ui/components';
import type { ReactNode } from 'react';
import type { DataPaths } from '../../api';
import type { SettingKey } from './settings';
import type { HotkeyEditor } from './useHotkeyEditor';

export interface SettingsCtx {
  values: Record<SettingKey, string>;
  set: (key: SettingKey, value: string) => void;
  /** Changed since the window opened — what the group dots report. */
  changedSince: (key: SettingKey) => boolean;
  /** Put those keys back to the values the window opened with. */
  discard: (...keys: SettingKey[]) => void;
  /** Every preference AND every keyboard shortcut back to its shipped default. */
  resetAll: () => void;
  hotkeys: HotkeyEditor;
  /** Bundle version, or null while loading (or if the query fails). */
  version: string | null;
  /** Absolute data locations, or null while loading. */
  paths: DataPaths | null;
  /** The two things that force reduced motion regardless of the preference:
   *  macOS Low Power Mode, and the system's own Reduce Motion setting. */
  motion: { lowPower: boolean; systemPrefers: boolean };
}

export interface RowSpec {
  id: string;
  title: string;
  description?: string;
  /** Extra words search should match — synonyms, values, the old name. */
  keywords?: string;
  layout?: SettingRowLayout;
  control: (ctx: SettingsCtx) => ReactNode;
  footnote?: (ctx: SettingsCtx) => ReactNode;
}

export interface GroupSpec {
  id: string;
  label: string;
  hint?: string;
  rows: RowSpec[];
  /** Something in the group was changed this session — lights the header dot,
   *  which is also the control that discards those changes. */
  changed?: boolean;
  onDiscard?: () => void;
}

export interface PaneSpec {
  id: string;
  label: string;
  icon: string;
  /** Muted lead-in above the groups (hidden while searching). */
  intro?: string;
  groups: (ctx: SettingsCtx) => GroupSpec[];
}
