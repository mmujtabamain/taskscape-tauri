import { ABOUT_PANE } from './aboutPane';
import { CAPTURE_PANE } from './capturePane';
import { GENERAL_PANE } from './generalPane';
import { SHORTCUTS_PANE } from './shortcutsPane';
import type { GroupSpec, PaneSpec } from './types';

/** Sidebar order. */
export const PANES: PaneSpec[] = [
  GENERAL_PANE,
  CAPTURE_PANE,
  SHORTCUTS_PANE,
  ABOUT_PANE,
];

/** Narrow groups to rows matching every whitespace-separated token in `query`,
 *  dropping groups left with none. The group label is part of the haystack, so
 *  "appearance" finds the rows inside the Appearance group. */
export function filterGroups(groups: GroupSpec[], query: string): GroupSpec[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => {
        const haystack = [
          group.label,
          row.title,
          row.description ?? '',
          row.keywords ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      }),
    }))
    .filter((group) => group.rows.length > 0);
}

export const countRows = (groups: GroupSpec[]): number =>
  groups.reduce((n, group) => n + group.rows.length, 0);
