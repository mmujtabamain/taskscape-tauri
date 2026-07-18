/** Drag payload used to drop an attachment into a note as a mention chip. Kept
 *  in its own tiny module (separate from the tiptap-heavy RichTextEditor) so
 *  non-editor code can reference it without pulling in the editor bundle. */
export const ATTACHMENT_MIME = 'application/x-attachment';
