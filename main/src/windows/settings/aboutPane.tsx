import { SelectableText } from '../../components/SelectableText';
import { PathButton } from './PathButton';
import { ResetEverything } from './ResetEverything';
import type { PaneSpec } from './types';

export const ABOUT_PANE: PaneSpec = {
  id: 'about',
  label: 'About',
  icon: 'info',
  groups: () => [
    {
      id: 'application',
      label: 'Application',
      rows: [
        {
          id: 'version',
          title: 'Taskscape',
          description: 'A macOS task manager with a menu-bar capture bar.',
          keywords: 'version build number release about',
          control: (ctx) => (
            <SelectableText className="text-content-2l dark:text-content-2d font-mono text-[11.5px]">
              {ctx.version ?? '—'}
            </SelectableText>
          ),
        },
        {
          id: 'data_dir',
          title: 'Data folder',
          description:
            'Tasks, attachments, screenshots and preferences. Click to open it.',
          keywords:
            'path directory location database sqlite backup storage finder',
          layout: 'stacked',
          control: (ctx) => <PathButton path={ctx.paths?.data_dir ?? null} />,
        },
      ],
    },
    {
      id: 'reset',
      label: 'Reset',
      rows: [
        {
          id: 'reset_all',
          title: 'Restore defaults',
          description:
            'Puts appearance, capture and task preferences — and every keyboard shortcut — back the way they shipped. Your tasks are untouched.',
          keywords: 'reset clear defaults factory revert erase preferences',
          layout: 'stacked',
          control: (ctx) => <ResetEverything onConfirm={ctx.resetAll} />,
        },
      ],
    },
  ],
};
