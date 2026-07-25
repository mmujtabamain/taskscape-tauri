import { cn } from '@taskscape/common-ui/cn';
import {
  Checkbox,
  DashedButton,
  IconButton,
  Label,
  SectionHeader,
  ToolbarButton,
} from '@taskscape/common-ui/components';
import { Icon } from '@taskscape/common-ui/Icon';
import { useEffect, useRef, useState } from 'react';
import { api, type Note, type Task } from '../../api';
import { requestDeleteTask, updateTask } from '../../commands/tasks';
import { confirmModal } from '../../lib/modal';
import { toggleDone as actToggleDone } from '../../stores/actions';
import { useLayoutStore } from '../../stores/layoutStore';
import { useListStore } from '../../stores/listStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUiStore } from '../../stores/uiStore';
import { absoluteDateTime, relativeTime } from '../../time';
import { AttachmentLightbox } from '../AttachmentLightbox';
import { AttachmentSection } from './AttachmentSection';
import { NoteCard } from './NoteCard';
import { AUTOSAVE_MS, requestNoteLink } from './noteEditing';
import { RichTextEditor, type RichTextHandle } from './RichTextEditorLazy';

const refresh = () => void useTaskStore.getState().load();
const selectTask = (id: string) => useSelectionStore.getState().focus(id);

const SUBTASK_INDENT = 18;

/** One row of the subtask tree, recursing into its own children so the inspector
 *  mirrors the full nesting shown in the list pane. Indent grows per depth; the
 *  hover bleed (`-mx-1.5`) stays intact by only overriding padding-left. */
function SubtaskRow({ task, depth }: { task: Task; depth: number }) {
  const children = useTaskStore((s) => s.childrenByParent[task.id]) ?? [];
  return (
    <>
      <div
        className="rounded-field hover:bg-wash-1l dark:hover:bg-wash-1d gap-space-5 pr-space-4 -mx-1.5 flex h-8 items-center"
        style={{ paddingLeft: 6 + depth * SUBTASK_INDENT }}
      >
        <Checkbox
          checked={task.done}
          size="sm"
          title={task.done ? 'Mark not done' : 'Mark done'}
          onClick={() => void actToggleDone(task)}
        />
        <Label
          as="button"
          onClick={() => selectTask(task.id)}
          title={task.title}
          truncate
          tone={task.done ? 'muted' : 'primary'}
          className={cn(
            'min-w-0 flex-1 text-left text-[13.5px]',
            task.done && 'line-through'
          )}
        >
          {task.title}
        </Label>
      </div>
      {children.map((child) => (
        <SubtaskRow key={child.id} task={child} depth={depth + 1} />
      ))}
    </>
  );
}

/** The single-task inspector. Reads the task's list/project/children from the
 *  stores, manages in-place title editing and note autosave locally, and hosts
 *  the shared attachment lightbox. Keyed by task.id in the router, so it remounts
 *  (reseeding local notes) on selection change. */
export function TaskInspector({ task }: { task: Task }) {
  const lists = useListStore((s) => s.lists);
  const projects = useProjectStore((s) => s.projects);
  const list = lists.find((l) => l.id === task.list_id);
  const listName = list?.name ?? null;
  const projectName =
    projects.find((p) => p.id === list?.project_id)?.name ?? null;
  const children = useTaskStore((s) => s.childrenByParent[task.id]) ?? [];
  const doneChildren = children.filter((c) => c.done).length;

  const titleEditReq = useUiStore((s) => s.titleEditReq);
  const addNoteReq = useUiStore((s) => s.addNoteReq);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [copied, setCopied] = useState(false);
  const addNoteRef = useRef<RichTextHandle>(null);
  const addCreated = useRef<Note | null>(null);
  const addTimer = useRef<number | undefined>(undefined);
  const addLastSaved = useRef('');
  const addChain = useRef<Promise<void>>(Promise.resolve());

  // Notes are managed locally so autosave never has to refetch the task (which
  // would remount the editor you're typing in). Seeded per task — this inspector
  // is keyed by task.id, so it remounts (and reseeds) on selection change.
  const [notes, setNotes] = useState<Note[]>(task.note_items);

  const openMention = (name: string) => {
    const idx = task.attachments.findIndex((a) => a.name === name);
    if (idx >= 0) setLightboxIndex(idx);
    else {
      const remote = task.attachments.find((a) => a.name === name);
      if (remote) void api.openAttachment(remote);
    }
  };

  // An existing note's edits autosave in place — fire-and-forget onto the backend
  // write queue. The editor holds the live content, so we deliberately don't
  // refetch here (that would remount the editor mid-edit).
  const saveNote = (id: string, html: string) => {
    void api.updateNote(id, html);
  };

  // A note cleared to empty and blurred is removed.
  const discardNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    void api.deleteNote(id).then(refresh);
  };

  const removeNote = async (note: Note) => {
    const ok = await confirmModal({
      danger: true,
      title: 'Delete note?',
      message: 'This note will be permanently removed.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    await api.deleteNote(note.id);
    refresh();
  };

  // Add-note editor: create the row on the first keystroke, then stream edits.
  // Saves are serialized through a promise chain so the create can't double-fire
  // and a blur can await the final write before promoting the draft to a card.
  const addNoteSave = async (final: boolean) => {
    const html = addNoteRef.current?.getHtml() ?? '';
    if (!html) {
      if (final && addCreated.current) {
        const id = addCreated.current.id;
        addCreated.current = null;
        addLastSaved.current = '';
        await api.deleteNote(id);
      }
      return;
    }
    if (!final && html === addLastSaved.current) return;
    if (!addCreated.current) {
      addCreated.current = await api.createNote(task.id, html);
      addLastSaved.current = html;
    } else if (html !== addLastSaved.current) {
      addLastSaved.current = html;
      void api.updateNote(addCreated.current.id, html);
    }
  };

  const enqueueAddNote = (final: boolean) => {
    addChain.current = addChain.current
      .then(() => addNoteSave(final))
      .catch(() => {});
    return addChain.current;
  };

  const scheduleAddNote = () => {
    window.clearTimeout(addTimer.current);
    addTimer.current = window.setTimeout(
      () => enqueueAddNote(false),
      AUTOSAVE_MS
    );
  };

  const finishAddNote = async () => {
    window.clearTimeout(addTimer.current);
    await enqueueAddNote(true);
    const created = addCreated.current;
    const html = addNoteRef.current?.getHtml() ?? '';
    addCreated.current = null;
    addLastSaved.current = '';
    setAddingNote(false);
    if (created && html)
      setNotes((prev) => [...prev, { ...created, content: html }]);
    refresh();
  };

  const startTitleEdit = () => {
    setTitleDraft(task.title);
    setEditingTitle(true);
  };

  const commitTitle = () => {
    if (!editingTitle) return;
    const t = titleDraft.trim();
    if (t && t !== task.title) updateTask(task.id, { title: t });
    else setTitleDraft(task.title);
    setEditingTitle(false);
  };

  // A rename requested from a task row (or F2/Enter) reaches this inspector as a
  // uiStore token. Begin editing during render (React's "you might not need an
  // effect" state adjustment); the effect then clears the token so it can't
  // re-fire when the task is reselected later.
  const renameRequested = titleEditReq?.id === task.id;
  if (renameRequested && !editingTitle) {
    setTitleDraft(task.title);
    setEditingTitle(true);
  }
  useEffect(() => {
    if (renameRequested) useUiStore.getState().clearTitleEditReq();
  }, [renameRequested]);

  // A draft's "Add note" promotes the draft to this task and asks us to open the
  // note editor straight away (same during-render + clear-in-effect pattern).
  const addNoteRequested = addNoteReq?.id === task.id;
  if (addNoteRequested && !addingNote) setAddingNote(true);
  useEffect(() => {
    if (addNoteRequested) useUiStore.getState().clearAddNoteReq();
  }, [addNoteRequested]);

  // Focus and select when editing opens, from any trigger.
  useEffect(() => {
    if (!editingTitle) return;
    const el = titleRef.current;
    el?.focus();
    el?.select();
  }, [editingTitle]);

  // Grow the field to fit the wrapped title so display and edit share a height
  // (no swap, no layout shift) — the whole point of editing in place.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [task.title, titleDraft, editingTitle]);

  // Copy the task the same way every other copy path does — through the backend
  // markdown render, so the title and all its notes travel together.
  const copyTask = async () => {
    try {
      const md = await api.copyTasks([task.id]);
      await navigator.clipboard.writeText(md || task.title);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  };

  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col">
      <div className="p-space-7 relative shrink-0">
        {/* Index tick: the panel "receives" the selection. */}
        <span className="bg-accent-500l dark:bg-accent-500d absolute top-4.75 left-0 h-4 w-0.5" />
        <div className="gap-space-5 flex items-start">
          <div className="mt-0.5">
            <Checkbox
              checked={task.done}
              size="md"
              title={task.done ? 'Mark not done' : 'Mark done'}
              onClick={() => void actToggleDone(task)}
            />
          </div>
          <div className="min-w-0 flex-1">
            {/* One field for display and edit: readonly text that wraps, gaining a
                fill + same-color ring (a padding halo) when editing — never a swap. */}
            <textarea
              ref={titleRef}
              rows={1}
              spellCheck={false}
              readOnly={!editingTitle}
              placeholder="Untitled"
              value={editingTitle ? titleDraft : task.title}
              onChange={(e) => setTitleDraft(e.target.value)}
              onClick={() => {
                if (!editingTitle) startTitleEdit();
              }}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                }
                if (e.key === 'Escape') {
                  setTitleDraft(task.title);
                  setEditingTitle(false);
                }
              }}
              className={cn(
                'font-display text-content-1l dark:text-content-1d placeholder:text-content-3l dark:placeholder:text-content-3d rounded-field -ml-1 block w-full cursor-text resize-none overflow-hidden border-0 bg-transparent px-1 py-0 text-[18px] leading-6 font-semibold outline-none',
                editingTitle &&
                  'bg-surface-0l dark:bg-surface-0d ring-surface-0l dark:ring-surface-0d ring-2'
              )}
            />
            <Label
              as="div"
              tone="muted"
              className="mt-2.5 flex flex-col gap-1 text-[11.5px] tabular-nums"
            >
              <span className="flex items-center gap-1.5">
                <Icon
                  name="folder_open"
                  size={13}
                  weight={300}
                  className="text-content-3l dark:text-content-3d shrink-0"
                />
                <Label tone="secondary" truncate>
                  {projectName ?? '—'}
                </Label>
                {listName && <span className="shrink-0">/ {listName}</span>}
              </span>
              <span
                className="flex items-center gap-1.5"
                title={absoluteDateTime(task.created_at)}
              >
                <Icon
                  name="schedule"
                  size={13}
                  weight={300}
                  className="text-content-3l dark:text-content-3d shrink-0"
                />
                Created {relativeTime(task.created_at)}
              </span>
              <span
                className="flex items-center gap-1.5"
                title={absoluteDateTime(task.updated_at)}
              >
                <Icon
                  name="update"
                  size={13}
                  weight={300}
                  className="text-content-3l dark:text-content-3d shrink-0"
                />
                Updated {relativeTime(task.updated_at)}
              </span>
            </Label>
          </div>
          <div className="gap-space-1 -mt-1 -mr-1 flex shrink-0 flex-col items-center">
            <IconButton
              icon="last_page"
              iconSize={16}
              onClick={() => useLayoutStore.getState().setPreviewOpen(false)}
              title="Close panel"
            />
            <IconButton
              icon="edit"
              iconSize={15}
              iconWeight={300}
              onClick={startTitleEdit}
              title="Rename"
            />
            <IconButton
              icon={copied ? 'check' : 'content_copy'}
              iconSize={15}
              onClick={copyTask}
              title={copied ? 'Copied' : 'Copy task'}
            />
            <IconButton
              icon="delete"
              iconSize={15}
              variant="danger"
              onClick={() => void requestDeleteTask(task)}
              title="Delete task"
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="p-space-7 pt-0">
          <SectionHeader
            label="Notes"
            trailing={
              notes.length > 0 ? (
                <div className="gap-space-3 flex items-center">
                  <Label tone="muted" className="text-[11px] tabular-nums">
                    {notes.length}
                  </Label>
                  <ToolbarButton
                    icon="add"
                    iconSize={14}
                    onClick={() => setAddingNote(true)}
                    title="Add note"
                  >
                    Note
                  </ToolbarButton>
                </div>
              ) : undefined
            }
          />

          <div className="gap-space-5 flex flex-col">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                attachments={task.attachments}
                onOpenMention={openMention}
                onSave={saveNote}
                onEmptied={discardNote}
                onDelete={() => removeNote(note)}
              />
            ))}

            {addingNote ? (
              <RichTextEditor
                ref={addNoteRef}
                autoFocus
                placeholder="Write a note ... (drop an attachment to @mention it)"
                minHeightClass="min-h-24"
                attachments={task.attachments}
                onOpenMention={openMention}
                onRequestLink={requestNoteLink}
                onChange={scheduleAddNote}
                onBlur={() => {
                  // The link toolbar opens a native modal window (and the user
                  // may just switch apps); either drops window focus. Keep the
                  // editor mounted then so that flow can return to it — finalize
                  // only when focus stays in this window (clicked elsewhere here).
                  if (document.hasFocus()) void finishAddNote();
                }}
              />
            ) : notes.length === 0 ? (
              <DashedButton
                onClick={() => setAddingNote(true)}
                className="h-24 w-full font-semibold"
              >
                <Icon name="add" size={16} />
                Add note
              </DashedButton>
            ) : null}
          </div>
        </div>

        {children.length > 0 && (
          <div className="p-space-7 pt-0">
            <SectionHeader
              label="Subtasks"
              trailing={
                <Label tone="muted" className="text-[11.5px] tabular-nums">
                  {doneChildren} done / {children.length}
                </Label>
              }
            />
            <div className="-mb-2">
              {children.map((child) => (
                <SubtaskRow key={child.id} task={child} depth={0} />
              ))}
            </div>
          </div>
        )}

        <AttachmentSection
          task={task}
          onRefresh={refresh}
          onOpenLightbox={setLightboxIndex}
        />
      </div>

      {lightboxIndex !== null && (
        <AttachmentLightbox
          attachments={task.attachments}
          index={lightboxIndex}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDeleted={() => {
            setLightboxIndex(null);
            refresh();
          }}
          onRenamed={refresh}
        />
      )}
    </div>
  );
}
