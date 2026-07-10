import { api } from '../api';
import { renameMentionInHtml } from '@taskscape/common-ui/sanitizeHtml';

/** After an attachment is renamed, follow the change into the owning task's
 *  notes so every `@mention` chip shows the new name. */
export async function propagateAttachmentRename(
  taskId: string,
  oldName: string,
  newName: string
): Promise<void> {
  if (!oldName || oldName === newName) return;
  const notes = await api.listNotes(taskId);
  await Promise.all(
    notes.map((n) => {
      const next = renameMentionInHtml(n.content, oldName, newName);
      return next != null ? api.updateNote(n.id, next) : Promise.resolve();
    })
  );
}
