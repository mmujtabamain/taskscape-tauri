import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api,
  type Attachment,
  type Note,
  type Task,
  type TaskPatch,
} from '../api';
import {
  attachmentSrc,
  fileKindFor,
  isRemote,
  splitFileName,
} from '../lib/fileKind';
import { propagateAttachmentRename } from '../lib/mentions';
import { confirmModal, openModal, promptName } from '../lib/modal';
import { absoluteDateTime, relativeTime } from '../time';
import { AttachmentLightbox } from './AttachmentLightbox';
import { useContextMenu } from './contextMenuContext';
import { Icon } from './Icon';
import {
  ATTACHMENT_MIME,
  RichTextEditor,
  type RichTextHandle,
} from './RichTextEditor';
import { Spinner } from './Spinner';

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

/** A saved note: its own rich-text editor that commits on blur (empty → delete),
 *  with a hover delete affordance. */
function NoteCard({
  note,
  attachments,
  onOpenMention,
  onCommit,
  onDelete,
}: {
  note: Note;
  attachments: Attachment[];
  onOpenMention: (name: string) => void;
  onCommit: (html: string) => void;
  onDelete: () => void;
}) {
  const ref = useRef<RichTextHandle>(null);
  return (
    <div className="group/note relative">
      <RichTextEditor
        ref={ref}
        initialHtml={note.content}
        minHeightClass="min-h-14"
        attachments={attachments}
        onOpenMention={onOpenMention}
        onBlur={() => onCommit(ref.current?.getHtml() ?? '')}
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
}: InspectorProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [addingNote, setAddingNote] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const addNoteRef = useRef<RichTextHandle>(null);
  const savingNote = useRef(false);
  const menu = useContextMenu();

  const children = childrenByParent[task.id] ?? [];
  const doneChildren = children.filter((c) => c.done).length;
  const notes = task.note_items;

  const openMention = (name: string) => {
    const idx = task.attachments.findIndex((a) => a.name === name);
    if (idx >= 0) setLightboxIndex(idx);
    else {
      const remote = task.attachments.find((a) => a.name === name);
      if (remote) void api.openAttachment(remote);
    }
  };

  const saveNewNote = async () => {
    if (savingNote.current) return;
    if (addNoteRef.current?.isEmpty() ?? true) {
      setAddingNote(false);
      return;
    }
    const html = addNoteRef.current?.getHtml() ?? '';
    savingNote.current = true;
    try {
      await api.createNote(task.id, html);
    } finally {
      savingNote.current = false;
    }
    setAddingNote(false);
    onRefresh();
  };

  const commitNote = async (note: Note, html: string) => {
    if (html === note.content) return;
    if (!html) {
      await api.deleteNote(note.id);
    } else {
      await api.updateNote(note.id, html);
    }
    onRefresh();
  };

  const removeNote = async (note: Note) => {
    const ok = await confirmModal({
      danger: true,
      title: 'Delete note?',
      message: 'This note will be permanently removed.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await api.deleteNote(note.id);
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

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== task.title) onUpdateTask(task.id, { title: t });
    else setTitleDraft(task.title);
    setEditingTitle(false);
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
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') {
                    setTitleDraft(task.title);
                    setEditingTitle(false);
                  }
                }}
                className="rounded-field bg-surface-0l dark:bg-surface-0d font-display text-content-1l dark:text-content-1d -mx-1 w-[calc(100%+8px)] px-1 text-[18px] leading-6 font-semibold outline-none"
              />
            ) : (
              <button
                onClick={() => {
                  setTitleDraft(task.title);
                  setEditingTitle(true);
                }}
                title="Click to edit"
                className="font-display text-content-1l dark:text-content-1d block w-full text-left text-[18px] leading-6 font-semibold"
              >
                {task.title}
              </button>
            )}
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
          <button
            onClick={onClose}
            title="Close panel"
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d -mt-1 -mr-1 grid h-6 w-6 shrink-0 place-items-center transition-colors"
          >
            <Icon name="last_page" size={16} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="p-4 pt-0">
          <SectionHeader
            label="Notes"
            trailing={
              notes.length > 0 ? (
                <span className="text-content-3l dark:text-content-3d text-[11px] tabular-nums">
                  {notes.length}
                </span>
              ) : undefined
            }
          />

          <div className="flex flex-col gap-2.5">
            {notes.map((note) => (
              <NoteCard
                key={`${note.id}:${note.updated_at}`}
                note={note}
                attachments={task.attachments}
                onOpenMention={openMention}
                onCommit={(html) => commitNote(note, html)}
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
                onBlur={() => {
                  // The link toolbar opens a native modal window (and the user
                  // may just switch apps); either drops window focus. Keep the
                  // editor mounted then so that flow can return to it — commit
                  // only when focus stays in this window (clicked elsewhere here).
                  if (document.hasFocus()) void saveNewNote();
                }}
                onSubmit={saveNewNote}
              />
            ) : (
              <button
                onClick={() => setAddingNote(true)}
                className="rounded-control bg-surface-3l dark:bg-surface-3d border-edge-3l dark:border-edge-3d text-content-3l dark:text-content-3d hover:border-content-3l dark:hover:border-content-3d hover:text-content-2l dark:hover:text-content-2d flex h-24 w-full items-center justify-center gap-1.5 border border-dashed font-semibold transition-colors"
              >
                <Icon name="add" size={16} />
                Add note
              </button>
            )}
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

          {task.attachments.length > 0 && (
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
          )}
        </div>

        <div className="border-edge-1l dark:border-edge-1d mt-auto border-t p-4">
          <button
            onClick={() => onRequestDelete(task)}
            className="rounded-field text-danger-500l dark:text-danger-500d hover:bg-danger-100l dark:hover:bg-danger-100d flex h-8 items-center gap-1.5 px-3 text-[13px] font-semibold transition-colors"
          >
            <Icon name="delete" size={15} />
            Delete task
          </button>
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

export function PreviewPanel(props: PreviewPanelProps) {
  const { task } = props;
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
