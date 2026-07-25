import {
  Label,
  Segmented,
  Toggle,
  type SegmentedItem,
} from '@taskscape/common-ui/components';
import type { ThemePref } from '../../lib/theme';
import type { GroupSpec, PaneSpec, SettingsCtx } from './types';

const THEMES: SegmentedItem<ThemePref>[] = [
  { value: 'system', label: 'System', icon: 'contrast' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
];

const asTheme = (value: string): ThemePref =>
  value === 'light' || value === 'dark' ? value : 'system';

/** Something outside the app has already decided motion is reduced. */
const forcesMotion = (ctx: SettingsCtx) =>
  ctx.motion.lowPower || ctx.motion.systemPrefers;

function appearance(ctx: SettingsCtx): GroupSpec {
  return {
    id: 'appearance',
    label: 'Appearance',
    changed: ctx.changedSince('theme') || ctx.changedSince('reduced_motion'),
    onDiscard: () => ctx.discard('theme', 'reduced_motion'),
    rows: [
      {
        id: 'theme',
        title: 'Theme',
        description: 'Follow the system appearance, or pin one.',
        keywords: 'dark light mode colour color appearance system',
        layout: 'stacked',
        control: (ctx) => (
          <Segmented
            variant="surfaceThumb"
            items={THEMES}
            value={asTheme(ctx.values.theme)}
            onChange={(next) => ctx.set('theme', next)}
          />
        ),
      },
      {
        id: 'reduced_motion',
        title: 'Reduced motion',
        description: 'Cuts animations and transitions to the minimum.',
        keywords: 'animation animations transitions battery low power motion',
        control: (ctx) => (
          <Toggle
            checked={forcesMotion(ctx) || ctx.values.reduced_motion === '1'}
            disabled={forcesMotion(ctx)}
            onChange={(next) => ctx.set('reduced_motion', next ? '1' : '0')}
            title="Reduced motion"
          />
        ),
        // The switch is only a preference while nothing else is forcing the
        // answer; when something is, say which, since the control is inert.
        footnote: (ctx) =>
          ctx.motion.lowPower ? (
            <Label as="p" tone="muted" className="text-[11px]">
              Due to Low Power Mode, reduced motion is on by default on macOS.
            </Label>
          ) : ctx.motion.systemPrefers ? (
            <Label as="p" tone="muted" className="text-[11px]">
              macOS Reduce Motion is on, so motion stays reduced.
            </Label>
          ) : null,
      },
    ],
  };
}

function tasks(ctx: SettingsCtx): GroupSpec {
  return {
    id: 'tasks',
    label: 'Tasks',
    changed: ctx.changedSince('show_completed'),
    onDiscard: () => ctx.discard('show_completed'),
    rows: [
      {
        id: 'show_completed',
        title: 'Show completed tasks',
        description: 'Keep finished tasks in the list instead of hiding them.',
        keywords: 'done finished hide completed checked',
        control: (ctx) => (
          <Toggle
            checked={ctx.values.show_completed !== '0'}
            onChange={(next) => ctx.set('show_completed', next ? '1' : '0')}
            title="Show completed tasks"
          />
        ),
      },
    ],
  };
}

export const GENERAL_PANE: PaneSpec = {
  id: 'general',
  label: 'General',
  icon: 'tune',
  groups: (ctx) => [appearance(ctx), tasks(ctx)],
};
