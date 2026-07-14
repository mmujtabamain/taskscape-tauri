import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api,
  type Attachment,
  type List,
  type Note,
  type Task,
  type TaskPatch,
} from '../api';
import {
  attachmentSrc,
  fileKindFor,
  isRemote,
  splitFileName,
} from '@taskscape/common-ui/fileKind';
import { propagateAttachmentRename } from '../lib/mentions';
import { confirmModal, openModal, promptName } from '../lib/modal';
import { absoluteDateTime, relativeTime } from '../time';
import { AttachmentLightbox } from './AttachmentLightbox';
import { useContextMenu } from './contextMenuContext';
import { Icon } from '@taskscape/common-ui/Icon';
import {
  ATTACHMENT_MIME,
  RichTextEditor,
  type RichTextHandle,
} from '@taskscape/common-ui/RichTextEditor';
import { Spinner } from '@taskscape/common-ui/Spinner';

interface PreviewPanelProps {
  task: Task | null;
  childrenByParent: Record<string, Task[]>;
  listName: string | null;
  projectName: string | null;
  onUpdateTask: (id: string, patch: TaskPatch) => void;
  onToggleDone: (task: Task) => void;
  onSelectTask: (id: string) => void;
  onRequestDelete: (task: Task) => void;
  onRefresh: () => void;
  onClose: () => void;
  /** When this points at the shown task, the inspector begins editing its title;
   *  `onTitleEditStarted` clears it so a later request can re-trigger. */
  titleEditReq: { id: string; n: number } | null;
  onTitleEditStarted: () => void;

  // ----- multi-select (focused pane's selection; >1 shows the multi inspector) -----
  selectionTasks?: Task[];
  listNameById?: (listId: string) => string | null;
  moveTargets?: List[];
  onBulkSetDone?: (done: boolean) => void;
  onBulkMove?: (listId: string) => void;
  onBulkDelete?: () => void;
  onBulkCopy?: () => void;
  onClearSelection?: () => void;
  /** Collapse the selection to a single task (the "Open" affordance). */
  onOpenOne?: (id: string) => void;
}

/** Prompt for a URL via the native modal; resolves the trimmed URL or null.
 *  Given to the note editor so its link button works in the main window. */
async function requestNoteLink(): Promise<string | null> {
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

function referenceName(location: string): string {
  if (isRemote(location)) {
    try {
      const url = new URL(location);
      return url.pathname.split('/').filter(Boolean).pop() || url.host;
    } catch {
      return location;
    }
  }
  return location.split(/[\\/]/).filter(Boolean).pop() || location;
}

function SectionHeader({
  label,
  trailing,
}: {
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="text-content-3l dark:text-content-3d text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </span>
      <span className="border-edge-1l dark:border-edge-1d flex-1 border-t" />
      {trailing}
    </div>
  );
}

/** Debounce for note autosave — how long typing pauses before a write is sent. */
const AUTOSAVE_MS = 500;

/** A saved note: its own rich-text editor that autosaves as you type (debounced)
 *  and on blur; clearing it to empty and blurring deletes it. The hover
 *  affordance deletes it outright (with confirmation, in the parent). */
function NoteCard({
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
      <button
        onClick={onDelete}
        title="Delete note"
        className="z-raised border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d text-content-3l dark:text-content-3d shadow-lift hover:text-danger-500l dark:hover:text-danger-500d absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full border opacity-0 transition-opacity group-hover/note:opacity-100"
      >
        <Icon name="close" size={14} weight={400} />
      </button>
    </div>
  );
}

function DoneCheckbox({
  done,
  size,
  onToggle,
}: {
  done: boolean;
  size: 14 | 18;
  onToggle: () => void;
}) {
  const box =
    size === 18 ? 'h-5 w-5 rounded-field' : 'h-[18px] w-[18px] rounded-field';
  return (
    <button
      onClick={onToggle}
      title={done ? 'Mark not done' : 'Mark done'}
      className={`grid shrink-0 place-items-center border-[1.5px] transition-colors ${box} ${
        done
          ? 'bg-done-lamp-1l dark:bg-done-lamp-1d text-on-accent border-transparent'
          : 'border-edge-3l dark:border-edge-3d hover:border-content-3l dark:hover:border-content-3d'
      }`}
    >
      {done && <Icon name="check" size={size === 18 ? 14 : 12} weight={700} />}
    </button>
  );
}

type InspectorProps = Omit<PreviewPanelProps, 'task'> & { task: Task };

function TaskInspector({
  task,
  childrenByParent,
  listName,
  projectName,
  onUpdateTask,
  onToggleDone,
  onSelectTask,
  onRequestDelete,
  onRefresh,
  onClose,
  titleEditReq,
  onTitleEditStarted,
}: InspectorProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [addingNote, setAddingNote] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const addNoteRef = useRef<RichTextHandle>(null);
  const addCreated = useRef<Note | null>(null);
  const addTimer = useRef<number | undefined>(undefined);
  const addLastSaved = useRef('');
  const addChain = useRef<Promise<void>>(Promise.resolve());
  const menu = useContextMenu();

  const children = childrenByParent[task.id] ?? [];
  const doneChildren = children.filter((c) => c.done).length;
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
    void api.deleteNote(id).then(onRefresh);
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
    onRefresh();
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
    onRefresh();
  };

  useEffect(() => {
    let alive = true;
    for (const a of task.attachments) {
      if (fileKindFor(a.name, a.location).label !== 'image') continue;
      attachmentSrc(a).then((src) => {
        if (!alive || !src) return;
        setThumbs((m) => (m.get(a.id) === src ? m : new Map(m).set(a.id, src)));
      });
    }
    return () => {
      alive = false;
    };
  }, [task.attachments]);

  const startTitleEdit = () => {
    setTitleDraft(task.title);
    setEditingTitle(true);
  };

  const commitTitle = () => {
    if (!editingTitle) return;
    const t = titleDraft.trim();
    if (t && t !== task.title) onUpdateTask(task.id, { title: t });
    else setTitleDraft(task.title);
    setEditingTitle(false);
  };

  // A rename requested from a task row (or F2/Enter) reaches this inspector as a
  // prop. Begin editing during render (React's "you might not need an effect"
  // state adjustment); the effect then clears the request in the parent so it
  // can't re-fire when the task is reselected later.
  const renameRequested = titleEditReq?.id === task.id;
  if (renameRequested && !editingTitle) {
    setTitleDraft(task.title);
    setEditingTitle(true);
  }
  useEffect(() => {
    if (renameRequested) onTitleEditStarted();
  }, [renameRequested, onTitleEditStarted]);

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

  const addFile = async () => {
    const picked = await open({
      multiple: false,
      title: 'Choose a file to copy',
    });
    if (typeof picked === 'string') {
      await api.addCopy(task.id, picked);
      onRefresh();
    }
  };

  const addScreenshot = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      await api.attachScreenshot(task.id);
      onRefresh();
    } finally {
      setCapturing(false);
    }
  };

  const addLink = async () => {
    const res = await openModal({
      icon: 'add_link',
      title: 'Add link',
      input: { placeholder: 'https:// or /absolute/path' },
      buttons: [
        { id: 'cancel', label: 'Cancel', variant: 'ghost' },
        { id: 'add', label: 'Add', variant: 'primary' },
      ],
    });
    const value = res.value?.trim();
    if (res.buttonId !== 'add' || !value) return;
    await api.addReference(task.id, referenceName(value), value);
    onRefresh();
  };

  const openTile = (a: Attachment) => {
    if (isRemote(a.location)) void api.openAttachment(a);
    else setLightboxIndex(task.attachments.findIndex((x) => x.id === a.id));
  };

  const renameAttachment = async (a: Attachment) => {
    const { base, ext } = splitFileName(a.name);
    const name = await promptName({
      title: 'Rename attachment',
      icon: 'drive_file_rename_outline',
      message:
        a.link_type === 'copy'
          ? 'The stored file is renamed to match.'
          : 'Renames the reference label; the linked file is untouched.',
      initialValue: base,
      suffix: ext ? `.${ext}` : undefined,
      confirmLabel: 'Rename',
    });
    if (!name || name === a.name) return;
    const updated = await api.renameAttachment(a.id, name);
    await propagateAttachmentRename(a.task_id, a.name, updated.name);
    onRefresh();
  };

  const removeAttachment = async (a: Attachment) => {
    const ok = await confirmModal({
      danger: true,
      title: 'Remove attachment?',
      message: a.name,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.deleteAttachment(a.id);
    onRefresh();
  };

  const openTileMenu = (e: React.MouseEvent, a: Attachment) => {
    e.preventDefault();
    menu.open({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'rename', label: 'Rename…', icon: 'drive_file_rename_outline' },
        { id: 'open', label: 'Open', icon: 'open_in_new' },
        ...(isRemote(a.location)
          ? []
          : [{ id: 'reveal', label: 'Reveal in Finder', icon: 'folder_open' }]),
        {
          id: 'remove',
          label: 'Remove',
          icon: 'delete',
          danger: true,
          dividerAbove: true,
        },
      ],
      onPick: (id) => {
        if (id === 'rename') renameAttachment(a);
        if (id === 'open') api.openAttachment(a);
        if (id === 'reveal') api.revealAttachment(a);
        if (id === 'remove') removeAttachment(a);
      },
    });
  };

  const headBtn =
    'rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center transition-colors';

  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 p-4">
        {/* Index tick: the panel "receives" the selection. */}
        <span className="bg-accent-500l dark:bg-accent-500d absolute top-4.75 left-0 h-4 w-0.5" />
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5">
            <DoneCheckbox
              done={task.done}
              size={18}
              onToggle={() => onToggleDone(task)}
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
              className={`font-display text-content-1l dark:text-content-1d rounded-field -ml-1 block w-full cursor-text resize-none overflow-hidden border-0 bg-transparent px-1 py-0 text-[18px] leading-6 font-semibold outline-none ${
                editingTitle
                  ? 'bg-surface-0l dark:bg-surface-0d ring-surface-0l dark:ring-surface-0d ring-2'
                  : ''
              }`}
            />
            <div className="text-content-3l dark:text-content-3d mt-2.5 flex flex-col gap-1 text-[11.5px] tabular-nums">
              <span className="flex items-center gap-1.5">
                <Icon
                  name="folder_open"
                  size={13}
                  weight={300}
                  className="text-content-3l dark:text-content-3d shrink-0"
                />
                <span className="text-content-2l dark:text-content-2d truncate">
                  {projectName ?? '—'}
                </span>
                {listName && (
                  <span className="text-content-3l dark:text-content-3d shrink-0">
                    / {listName}
                  </span>
                )}
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
            </div>
          </div>
          <div className="-mt-1 -mr-1 flex shrink-0 flex-col items-center gap-0.5">
            <button onClick={onClose} title="Close panel" className={headBtn}>
              <Icon name="last_page" size={16} />
            </button>
            <button onClick={startTitleEdit} title="Rename" className={headBtn}>
              <Icon name="edit" size={15} weight={300} />
            </button>
            <button
              onClick={copyTask}
              title={copied ? 'Copied' : 'Copy task'}
              className={headBtn}
            >
              <Icon name={copied ? 'check' : 'content_copy'} size={15} />
            </button>
            <button
              onClick={() => onRequestDelete(task)}
              title="Delete task"
              className="rounded-field text-content-3l dark:text-content-3d hover:bg-danger-100l dark:hover:bg-danger-100d hover:text-danger-500l dark:hover:text-danger-500d grid h-6 w-6 shrink-0 place-items-center transition-colors"
            >
              <Icon name="delete" size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="p-4 pt-0">
          <SectionHeader
            label="Notes"
            trailing={
              notes.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-content-3l dark:text-content-3d text-[11px] tabular-nums">
                    {notes.length}
                  </span>
                  <button
                    onClick={() => setAddingNote(true)}
                    title="Add note"
                    className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d flex h-7 items-center gap-1 px-2 text-[12px] font-semibold transition-colors"
                  >
                    <Icon name="add" size={14} />
                    Note
                  </button>
                </div>
              ) : undefined
            }
          />

          <div className="flex flex-col gap-2.5">
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
              <button
                onClick={() => setAddingNote(true)}
                className="rounded-control bg-surface-3l dark:bg-surface-3d border-edge-3l dark:border-edge-3d text-content-3l dark:text-content-3d hover:border-content-3l dark:hover:border-content-3d hover:text-content-2l dark:hover:text-content-2d flex h-24 w-full items-center justify-center gap-1.5 border border-dashed font-semibold transition-colors"
              >
                <Icon name="add" size={16} />
                Add note
              </button>
            ) : null}
          </div>
        </div>

        {children.length > 0 && (
          <div className="p-4 pt-0">
            <SectionHeader
              label="Subtasks"
              trailing={
                <span className="text-content-3l dark:text-content-3d text-[11.5px] tabular-nums">
                  {doneChildren} done / {children.length}
                </span>
              }
            />
            <div className="-mb-2">
              {children.map((child) => (
                <div
                  key={child.id}
                  className="rounded-field hover:bg-wash-1l dark:hover:bg-wash-1d -mx-1.5 flex h-8 items-center gap-2.5 px-1.5"
                >
                  <DoneCheckbox
                    done={child.done}
                    size={14}
                    onToggle={() => onToggleDone(child)}
                  />
                  <button
                    onClick={() => onSelectTask(child.id)}
                    title={child.title}
                    className={`min-w-0 flex-1 truncate text-left text-[13.5px] ${
                      child.done
                        ? 'text-content-3l dark:text-content-3d line-through'
                        : 'text-content-1l dark:text-content-1d'
                    }`}
                  >
                    {child.title}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 pt-0">
          <SectionHeader
            label="Attachments"
            trailing={
              <div className="flex items-center gap-0.5">
                <button
                  onClick={addScreenshot}
                  disabled={capturing}
                  title={
                    capturing
                      ? 'Capturing …'
                      : 'Capture the full screen and attach it'
                  }
                  className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d disabled:cursor-default disabled:hover:bg-transparent flex h-7 items-center gap-1 px-2 text-[12px] font-semibold transition-colors"
                >
                  {capturing ? (
                    <Spinner size={12} />
                  ) : (
                    <Icon name="screenshot_monitor" size={14} />
                  )}
                  {capturing ? 'Capturing …' : 'Shot'}
                </button>
                <button
                  onClick={addLink}
                  className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d flex h-7 items-center gap-1 px-2 text-[12px] font-semibold transition-colors"
                >
                  <Icon name="add_link" size={14} />
                  Link
                </button>
                <button
                  onClick={addFile}
                  className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d flex h-7 items-center gap-1 px-2 text-[12px] font-semibold transition-colors"
                >
                  <Icon name="note_add" size={14} />
                  File
                </button>
              </div>
            }
          />

          {task.attachments.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
              {task.attachments.map((a) => {
                const thumb = thumbs.get(a.id);
                return (
                  <div key={a.id} className="min-w-0">
                    <button
                      onClick={() => openTile(a)}
                      onContextMenu={(e) => openTileMenu(e, a)}
                      title={`${a.name}\nRight-click to rename · drag onto a note to @mention`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(ATTACHMENT_MIME, a.name);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      className="group rounded-control border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d hover:border-edge-3l dark:hover:border-edge-3d relative block aspect-square w-full overflow-hidden border transition-colors"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center">
                          <Icon
                            name={fileKindFor(a.name, a.location).icon}
                            size={22}
                            className="text-content-3l dark:text-content-3d"
                          />
                        </span>
                      )}
                      <span className="bg-surface-3l dark:bg-surface-3d text-content-2l dark:text-content-2d absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full opacity-0 transition-opacity group-hover:opacity-100">
                        <Icon name="open_in_full" size={14} />
                      </span>
                    </button>
                    <div className="text-content-3l dark:text-content-3d mt-1 truncate text-center text-[11px]">
                      {a.name}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-control bg-surface-3l dark:bg-surface-3d border-edge-3l dark:border-edge-3d flex h-20 w-full items-stretch gap-1 border border-dashed p-1">
              <button
                onClick={addFile}
                title="Copy a file into this task"
                className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-2l dark:hover:text-content-2d flex flex-1 flex-col items-center justify-center gap-1 text-[12.5px] font-semibold transition-colors"
              >
                <Icon name="note_add" size={18} />
                Copy a file
              </button>
              <span className="border-edge-2l dark:border-edge-2d my-2 border-l" />
              <button
                onClick={addLink}
                title="Link a file or URL without copying"
                className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-2l dark:hover:text-content-2d flex flex-1 flex-col items-center justify-center gap-1 text-[12.5px] font-semibold transition-colors"
              >
                <Icon name="add_link" size={18} />
                Add a link
              </button>
            </div>
          )}
        </div>
      </div>

      {lightboxIndex !== null && (
        <AttachmentLightbox
          attachments={task.attachments}
          index={lightboxIndex}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDeleted={() => {
            setLightboxIndex(null);
            onRefresh();
          }}
          onRenamed={onRefresh}
        />
      )}
    </div>
  );
}

/** Shown when the focused pane has more than one task selected: a combined
 *  tally, the bulk verbs, and a peek-able list. Clicking a row peeks (highlights
 *  without collapsing the selection); "Open" narrows to that single task. */
function MultiInspector({
  tasks,
  activeId,
  listNameById,
  moveTargets,
  onSelectTask,
  onToggleDone,
  onOpenOne,
  onBulkSetDone,
  onBulkMove,
  onBulkDelete,
  onBulkCopy,
  onClearSelection,
}: {
  tasks: Task[];
  activeId: string | null;
  listNameById?: (listId: string) => string | null;
  moveTargets?: List[];
  onSelectTask: (id: string) => void;
  onToggleDone: (task: Task) => void;
  onOpenOne?: (id: string) => void;
  onBulkSetDone?: (done: boolean) => void;
  onBulkMove?: (listId: string) => void;
  onBulkDelete?: () => void;
  onBulkCopy?: () => void;
  onClearSelection?: () => void;
}) {
  const menu = useContextMenu();
  const done = tasks.filter((t) => t.done).length;
  const openMoveMenu = (e: React.MouseEvent) => {
    const targets = moveTargets ?? [];
    if (targets.length === 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({
      x: r.left,
      y: r.bottom + 4,
      items: targets.map((l) => ({ id: l.id, label: l.name })),
      onPick: (id) => onBulkMove?.(id),
    });
  };
  const act =
    'rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d flex h-8 items-center justify-center gap-1.5 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40';
  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-4">
        <div className="flex items-center gap-2.5">
          <span className="bg-accent-500l dark:bg-accent-500d text-on-accent grid h-8 min-w-8 place-items-center rounded-full px-2 text-[13px] font-bold tabular-nums">
            {tasks.length}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-content-1l dark:text-content-1d text-[16px] font-semibold">
              {tasks.length} tasks selected
            </p>
            <p className="text-content-3l dark:text-content-3d text-[11.5px] tabular-nums">
              {done} done / {tasks.length}
            </p>
          </div>
          <button
            onClick={onClearSelection}
            title="Clear selection"
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center transition-colors"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1">
          <button className={act} onClick={() => onBulkSetDone?.(true)}>
            <Icon name="task_alt" size={15} weight={300} />
            Done
          </button>
          <button className={act} onClick={() => onBulkSetDone?.(false)}>
            <Icon name="radio_button_unchecked" size={15} weight={300} />
            Undone
          </button>
          <button
            className={act}
            onClick={openMoveMenu}
            disabled={(moveTargets?.length ?? 0) === 0}
          >
            <Icon name="arrow_forward" size={15} weight={300} />
            Move
          </button>
          <button className={act} onClick={onBulkCopy}>
            <Icon name="content_copy" size={15} weight={300} />
            Copy
          </button>
          <button
            className={`${act} col-span-2 hover:text-danger-500l dark:hover:text-danger-500d`}
            onClick={onBulkDelete}
          >
            <Icon name="delete" size={15} weight={300} />
            Delete
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-0">
        <SectionHeader label="Selected" />
        <div className="-mx-1.5 flex flex-col">
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`group/sel rounded-field flex h-9 items-center gap-2.5 px-1.5 ${
                t.id === activeId
                  ? 'bg-selection-1l dark:bg-selection-1d'
                  : 'hover:bg-wash-1l dark:hover:bg-wash-1d'
              }`}
            >
              <DoneCheckbox
                done={t.done}
                size={14}
                onToggle={() => onToggleDone(t)}
              />
              <button
                onClick={() => onSelectTask(t.id)}
                title={t.title}
                className={`min-w-0 flex-1 truncate text-left text-[13.5px] ${
                  t.done
                    ? 'text-content-3l dark:text-content-3d line-through'
                    : 'text-content-1l dark:text-content-1d'
                }`}
              >
                {t.title}
              </button>
              {listNameById?.(t.list_id) && (
                <span className="rounded-field border-edge-2l dark:border-edge-2d text-content-3l dark:text-content-3d shrink-0 border px-1.5 text-[10.5px] font-semibold">
                  {listNameById(t.list_id)}
                </span>
              )}
              <button
                onClick={() => onOpenOne?.(t.id)}
                title="Open"
                className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-2l dark:hover:bg-wash-2d hover:text-content-1l dark:hover:text-content-1d grid h-6 w-6 shrink-0 place-items-center opacity-0 transition-opacity group-hover/sel:opacity-100"
              >
                <Icon name="open_in_full" size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PreviewPanel(props: PreviewPanelProps) {
  const { task, selectionTasks } = props;
  if ((selectionTasks?.length ?? 0) > 1) {
    return (
      <div className="bg-surface-1l dark:bg-surface-1d flex h-full flex-col overflow-hidden">
        <MultiInspector
          tasks={selectionTasks!}
          activeId={task?.id ?? null}
          listNameById={props.listNameById}
          moveTargets={props.moveTargets}
          onSelectTask={props.onSelectTask}
          onToggleDone={props.onToggleDone}
          onOpenOne={props.onOpenOne}
          onBulkSetDone={props.onBulkSetDone}
          onBulkMove={props.onBulkMove}
          onBulkDelete={props.onBulkDelete}
          onBulkCopy={props.onBulkCopy}
          onClearSelection={props.onClearSelection}
        />
      </div>
    );
  }
  return (
    <div className="bg-surface-1l dark:bg-surface-1d flex h-full flex-col overflow-hidden">
      {task ? (
        <TaskInspector key={task.id} {...props} task={task} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <Icon
            name="left_click"
            size={28}
            weight={200}
            className="text-content-3l dark:text-content-3d mb-1"
          />
          <p className="font-display text-content-2l dark:text-content-2d text-[17px] font-medium">
            No task selected
          </p>
          <p className="text-content-3l dark:text-content-3d text-[13px]">
            Select a task to inspect it
          </p>
        </div>
      )}
    </div>
  );
}
