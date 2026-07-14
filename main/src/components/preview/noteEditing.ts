import { openModal } from '../../lib/modal';

/** Debounce for note autosave — how long typing pauses before a write is sent. */
export const AUTOSAVE_MS = 500;

/** Prompt for a URL via the native modal; resolves the trimmed URL or null. Given
 *  to the note editor so its link button works in the main window. */
export async function requestNoteLink(): Promise<string | null> {
  const res = await openModal({
    icon: 'add_link',
    title: 'Add link',
    input: { placeholder: 'https://…' },
    buttons: [
      { id: 'cancel', label: 'Cancel', variant: 'ghost' },
      { id: 'add', label: 'Add link', variant: 'primary' },
    ],
  });
  const url = res.value?.trim();
  return res.buttonId === 'add' && url ? url : null;
}
