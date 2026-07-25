import { IconButton } from '@taskscape/common-ui/components';
import { useEffect, useRef } from 'react';
import type { Attachment, Note } from '../../api';
import { AUTOSAVE_MS, requestNoteLink } from './noteEditing';
import { RichTextEditor, type RichTextHandle } from './RichTextEditorLazy';

/** A saved note: its own rich-text editor that autosaves as you type (debounced)
 *  and on blur; clearing it to empty and blurring deletes it. The hover
 *  affordance deletes it outright (with confirmation, in the parent). */
export function NoteCard({
  note,
  attachments,
  onOpenMention,
  onSave,
  onEmptied,
  onDelete,
}: {
  note: Note;
  attachments: Attachment[];
  onOpenMention: (name: string) => void;
  onSave: (id: string, html: string) => void;
  onEmptied: (id: string) => void;
  onDelete: () => void;
}) {
  const ref = useRef<RichTextHandle>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastSaved = useRef(note.content);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = () => {
    const html = ref.current?.getHtml() ?? '';
    if (html && html !== lastSaved.current) {
      lastSaved.current = html;
      onSave(note.id, html);
    }
  };

  const flush = () => {
    window.clearTimeout(timer.current);
    const html = ref.current?.getHtml() ?? '';
    // Emptied and blurred → delete; otherwise persist any unsaved change.
    if (!html) {
      if (lastSaved.current !== '') onEmptied(note.id);
      return;
    }
    save();
  };

  return (
    <div className="group/note relative">
      <RichTextEditor
        ref={ref}
        initialHtml={note.content}
        minHeightClass="min-h-14"
        attachments={attachments}
        onOpenMention={onOpenMention}
        onRequestLink={requestNoteLink}
        onChange={() => {
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(save, AUTOSAVE_MS);
        }}
        onBlur={flush}
      />
      <IconButton
        icon="close"
        iconSize={14}
        iconWeight={400}
        variant="plain"
        onClick={onDelete}
        title="Delete note"
        className="z-raised border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d shadow-lift hover:text-danger-500l dark:hover:text-danger-500d absolute -top-2 -right-2 rounded-full border opacity-0 group-hover/note:opacity-100"
      />
    </div>
  );
}
