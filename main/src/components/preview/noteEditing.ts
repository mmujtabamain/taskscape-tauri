import { askText } from '../../lib/sheet';

/** Debounce for note autosave — how long typing pauses before a write is sent. */
export const AUTOSAVE_MS = 500;

/** Prompt for a URL via a sheet; resolves the trimmed URL or null. Given to the
 *  note editor so its link button works in the main window. */
export function requestNoteLink(): Promise<string | null> {
  return askText({
    glyph: 'add_link',
    headline: 'Add link',
    placeholder: 'https://…',
    accept: 'Add link',
  });
}
