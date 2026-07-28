// Sheets are how the app asks a question: one dense panel dropped from the top
// of the window, answered with ⏎ or esc (see components/SheetHost).
//
// A sheet spec describes the *question*, never the buttons — there is exactly one
// accept action, one dismissal, and an optional `instead` for a third path. The
// result comes back as a named action, so callers branch on meaning
// (`res.action === 'instead'`) instead of matching button ids.
import type { SheetTone } from '@taskscape/common-ui/components';
import { useSheetStore } from '../stores/sheetStore';

export interface AskSpec {
  placeholder?: string;
  /** Prefilled and selected on open, so typing replaces it. */
  value?: string;
  /** A locked, greyed tail (`.png`): uneditable, dot-proof, appended on accept. */
  tail?: string;
  /** Offer a dice that rolls a name from this pool. */
  dice?: 'project' | 'list';
}

export interface InsteadSpec {
  /** Comes back as `{ action: 'instead', id }`. */
  id: string;
  label: string;
}

export interface SheetSpec {
  /** Material Symbols glyph in the header strip. */
  glyph?: string;
  /** `accent` (default) for anything undoable, `danger` for anything that isn't. */
  tone?: SheetTone;
  /** What's happening, in one line — it truncates, so keep it short. */
  headline: string;
  /** The consequence, in one line. */
  detail?: string;
  /** Turns the sheet into a prompt: the body becomes the field. */
  ask?: AskSpec;
  /** The verb on the ⏎ button ("Create", "Delete list"). */
  accept: string;
  /** A third way out, in the footer's left corner. */
  instead?: InsteadSpec;
}

export type SheetResult =
  | { action: 'accept'; text: string }
  | { action: 'instead'; id: string }
  | { action: 'dismiss' };

/** Open a sheet; resolves once it's answered or dismissed. `text` is the trimmed
 *  field value with any `tail` appended, and is `''` for a sheet with no `ask`. */
export function openSheet(spec: SheetSpec): Promise<SheetResult> {
  return useSheetStore.getState().open(spec);
}

/** Ask for a line of text. Resolves the trimmed value, or null if dismissed. */
export async function askText(
  spec: Omit<SheetSpec, 'ask' | 'instead'> & AskSpec
): Promise<string | null> {
  const { placeholder, value, tail, dice, ...rest } = spec;
  const res = await openSheet({
    ...rest,
    ask: { placeholder, value, tail, dice },
  });
  return res.action === 'accept' ? res.text : null;
}

/** Ask a yes/no question. Resolves true only if the accept action was taken. */
export async function askConfirm(
  spec: Omit<SheetSpec, 'ask' | 'instead'>
): Promise<boolean> {
  const res = await openSheet(spec);
  return res.action === 'accept';
}
