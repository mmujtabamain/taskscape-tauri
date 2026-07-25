import {
  Label,
  Segmented,
  type SegmentedItem,
} from '@taskscape/common-ui/components';
import { PathButton } from './PathButton';
import type { PaneSpec } from './types';

type ScreenshotMode = 'fullscreen' | 'region';

const MODES: SegmentedItem<ScreenshotMode>[] = [
  { value: 'fullscreen', label: 'Full screen', icon: 'fullscreen' },
  { value: 'region', label: 'Region', icon: 'crop_free' },
];

const HINT: Record<ScreenshotMode, string> = {
  fullscreen: 'Capture the entire screen instantly.',
  region: 'Drag to select an area, or press Space to grab a window. Esc cancels.',
};

const asMode = (value: string): ScreenshotMode =>
  value === 'region' ? 'region' : 'fullscreen';

export const CAPTURE_PANE: PaneSpec = {
  id: 'capture',
  label: 'Capture',
  icon: 'screenshot_monitor',
  groups: (ctx) => [
    {
      id: 'screenshots',
      label: 'Screenshots',
      changed: ctx.changedSince('screenshot_mode'),
      onDiscard: () => ctx.discard('screenshot_mode'),
      rows: [
        {
          id: 'screenshot_mode',
          title: 'Capture mode',
          keywords: 'screenshot capture region area window full screen',
          layout: 'stacked',
          control: (ctx) => (
            <Segmented
              variant="surfaceThumb"
              items={MODES}
              value={asMode(ctx.values.screenshot_mode)}
              onChange={(next) => ctx.set('screenshot_mode', next)}
            />
          ),
          footnote: (ctx) => (
            <Label as="p" tone="muted" className="text-[11px]">
              {HINT[asMode(ctx.values.screenshot_mode)]}
            </Label>
          ),
        },
        {
          id: 'screenshots_dir',
          title: 'Saved to',
          description: 'Click to open the folder.',
          keywords: 'folder path directory location disk screenshots finder',
          layout: 'stacked',
          control: (ctx) => (
            <PathButton path={ctx.paths?.screenshots_dir ?? null} />
          ),
        },
      ],
    },
  ],
};
