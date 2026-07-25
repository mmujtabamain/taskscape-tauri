import { Divider } from '@taskscape/common-ui/components';
import {
  RichTextEditor,
  type RichTextHandle,
} from '@taskscape/common-ui/RichTextEditor';
import { type RefObject } from 'react';
import { api } from '../api';

/** The collapsible notes area: the rich-text editor when open, else a Tab hint.
 *  Emptying and blurring the editor collapses it back to the hint. */
export function NotesSection({
  notesOpen,
  editorRef,
  onOpen,
  onSave,
  onCollapse,
}: {
  notesOpen: boolean;
  editorRef: RefObject<RichTextHandle | null>;
  onOpen: () => void;
  onSave: () => void;
  onCollapse: () => void;
}) {
  if (notesOpen) {
    return (
      <div className="min-h-0 overflow-hidden">
        <RichTextEditor
          ref={editorRef}
          autoFocus
          attachments={[]}
          placeholder="Notes ..."
          minHeightClass="min-h-16"
          maxHeightClass="max-h-40"
          floatingToolbar={false}
          wrapperClassName=""
          toolbarClassName="border-edge-1l dark:border-edge-1d gap-1 border-t px-2 py-1.5"
          submitOnModEnter
          onSubmit={onSave}
          onEscape={() => api.hideMini()}
          // Leaving the notes empty collapses the panel back to the hint —
          // toolbar clicks preventDefault their blur, so they don't trip this.
          onBlur={() => {
            if (editorRef.current?.isEmpty()) onCollapse();
          }}
        />
        <Divider />
      </div>
    );
  }
  return (
    <div className="min-h-0 overflow-hidden">
      <button
        onClick={onOpen}
        className="text-content-3l dark:text-content-3d px-3 py-2 text-xs"
      >
        Press Tab to add a note
      </button>
      <Divider />
    </div>
  );
}
