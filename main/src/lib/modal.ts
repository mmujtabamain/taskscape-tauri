import { useModalStore } from '../stores/modalStore';

export interface ModalButton {
  id: string;
  label: string;
  variant?: 'primary' | 'danger' | 'ghost';
}

export interface ModalInput {
  label?: string;
  placeholder?: string;
  initialValue?: string;
  /** Show a "suggest another name" dice button that fills a random default
   *  name. The value picks which pool: celestial names for a project, or
   *  two-word landscape names for a list. */
  suggest?: 'project' | 'list';
  /** A locked, greyed suffix (e.g. a file extension `.png`) shown after the
   *  field. The user can't type `.` and the suffix is appended to the result. */
  suffix?: string;
}

export interface ModalProps {
  /** Material Symbols glyph shown beside the title. */
  icon?: string;
  tone?: 'default' | 'danger';
  title: string;
  message?: string;
  input?: ModalInput;
  /** Rendered right-aligned in order; the last one is the default (Enter). */
  buttons: ModalButton[];
}

export interface ModalResult {
  buttonId: string | null;
  value?: string;
}

/** Open an in-app modal overlay (rendered by `ModalHost`); resolves when a
 *  button is chosen, the timeout fires, or it's dismissed (buttonId: null). */
export function openModal(props: ModalProps): Promise<ModalResult> {
  return useModalStore.getState().open(props);
}

export async function confirmModal(opts: {
  title: string;
  message?: string;
  icon?: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const res = await openModal({
    icon: opts.icon ?? (opts.danger ? 'delete' : 'help'),
    tone: opts.danger ? 'danger' : 'default',
    title: opts.title,
    message: opts.message,
    buttons: [
      { id: 'cancel', label: 'Cancel', variant: 'ghost' },
      {
        id: 'confirm',
        label: opts.confirmLabel ?? 'Confirm',
        variant: opts.danger ? 'danger' : 'primary',
      },
    ],
  });
  return res.buttonId === 'confirm';
}

/** The "New list" dialog: name a fresh empty list, or branch off to import one
 *  from a JSON file. Import ignores the name field (the field carries a random
 *  suggested name); the imported list takes its name from the document. */
export async function promptNewList(): Promise<
  { action: 'create'; name: string } | { action: 'import' } | null
> {
  const res = await openModal({
    icon: 'list_alt_add',
    title: 'New list',
    input: { suggest: 'list' },
    buttons: [
      { id: 'cancel', label: 'Cancel', variant: 'ghost' },
      { id: 'import', label: 'Import from JSON…', variant: 'ghost' },
      { id: 'create', label: 'Create', variant: 'primary' },
    ],
  });
  if (res.buttonId === 'import') return { action: 'import' };
  const name = res.value?.trim();
  return res.buttonId === 'create' && name ? { action: 'create', name } : null;
}

/** Name prompt with a suggested default; resolves the trimmed name or null. */
export async function promptName(opts: {
  title: string;
  icon?: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Which default-name pool the dice suggests from. Passing this shows the
   *  suggestor even when renaming (with an `initialValue`); omit it and the
   *  dice appears only for a fresh name, from the list pool. */
  suggestKind?: 'project' | 'list';
  /** Locked, greyed suffix appended to the returned name (e.g. `.png`). */
  suffix?: string;
}): Promise<string | null> {
  const res = await openModal({
    icon: opts.icon ?? 'edit',
    title: opts.title,
    message: opts.message,
    input: {
      placeholder: opts.placeholder,
      initialValue: opts.initialValue,
      suffix: opts.suffix,
      suggest: opts.suggestKind ?? (opts.initialValue ? undefined : 'list'),
    },
    buttons: [
      { id: 'cancel', label: 'Cancel', variant: 'ghost' },
      {
        id: 'confirm',
        label: opts.confirmLabel ?? 'Create',
        variant: 'primary',
      },
    ],
  });
  const name = res.value?.trim();
  return res.buttonId === 'confirm' && name ? name : null;
}
