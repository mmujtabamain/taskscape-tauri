import { useEffect, useRef, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Attachment, type Note, type Task, type TaskPatch } from "../api";
import { attachmentSrc, fileKindFor, isRemote, splitFileName } from "../lib/fileKind";
import { confirmModal, openModal, promptName } from "../lib/modal";
import { propagateAttachmentRename } from "../lib/mentions";
import { absoluteDateTime, relativeTime } from "../time";
import { AttachmentLightbox } from "./AttachmentLightbox";
import { useContextMenu } from "./ContextMenu";
import { RichTextEditor, ATTACHMENT_MIME, type RichTextHandle } from "./RichTextEditor";
import { Icon } from "./Icon";

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
      return url.pathname.split("/").filter(Boolean).pop() || url.host;
    } catch {
      return location;
    }
  }
  return location.split(/[\\/]/).filter(Boolean).pop() || location;
}

function SectionHeader({ label, trailing }: { label: string; trailing?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
        {label}
      </span>
      <span className="flex-1 border-t border-hairline-faint" />
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
        onBlur={() => onCommit(ref.current?.getHtml() ?? "")}
      />
      <button
        onClick={onDelete}
        title="Delete note"
        className="absolute -top-2 -right-2 z-10 grid h-6 w-6 place-items-center rounded-full border border-hairline bg-raised text-ink-3 opacity-0 shadow-lift transition-opacity hover:text-danger group-hover/note:opacity-100"
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
  const box = size === 18 ? "h-5 w-5 rounded-[6px]" : "h-[18px] w-[18px] rounded-[5px]";
  return (
    <button
      onClick={onToggle}
      title={done ? "Mark not done" : "Mark done"}
      className={`grid shrink-0 place-items-center border-[1.5px] transition-colors ${box} ${
        done
          ? "border-transparent bg-done-lamp text-on-accent"
          : "border-hairline-strong hover:border-ink-3"
      }`}
    >
      {done && <Icon name="check" size={size === 18 ? 14 : 12} weight={700} />}
    </button>
  );
}

type InspectorProps = Omit<PreviewPanelProps, "task"> & { task: Task };

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
  const addNoteRef = useRef<RichTextHandle>(null);
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

  const addNote = async () => {
    const html = addNoteRef.current?.getHtml() ?? "";
    if (!html || addNoteRef.current?.isEmpty()) return;
    await api.createNote(task.id, html);
    addNoteRef.current?.clear();
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
      title: "Delete note?",
      message: "This note will be permanently removed.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await api.deleteNote(note.id);
    onRefresh();
  };

  useEffect(() => {
    let alive = true;
    for (const a of task.attachments) {
      if (fileKindFor(a.name, a.location).label !== "image") continue;
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
    const picked = await open({ multiple: false, title: "Choose a file to copy" });
    if (typeof picked === "string") {
      await api.addCopy(task.id, picked);
      onRefresh();
    }
  };

  const addScreenshot = async () => {
    await api.attachScreenshot(task.id);
    onRefresh();
  };

  const addLink = async () => {
    const res = await openModal({
      icon: "add_link",
      title: "Add link",
      input: { placeholder: "https:// or /absolute/path" },
      buttons: [
        { id: "cancel", label: "Cancel", variant: "ghost" },
        { id: "add", label: "Add", variant: "primary" },
      ],
    });
    const value = res.value?.trim();
    if (res.buttonId !== "add" || !value) return;
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
      title: "Rename attachment",
      icon: "drive_file_rename_outline",
      message:
        a.link_type === "copy"
          ? "The stored file is renamed to match."
          : "Renames the reference label; the linked file is untouched.",
      initialValue: base,
      suffix: ext ? `.${ext}` : undefined,
      confirmLabel: "Rename",
    });
    if (!name || name === a.name) return;
    const updated = await api.renameAttachment(a.id, name);
    await propagateAttachmentRename(a.task_id, a.name, updated.name);
    onRefresh();
  };

  const removeAttachment = async (a: Attachment) => {
    const ok = await confirmModal({
      danger: true,
      title: "Remove attachment?",
      message: a.name,
      confirmLabel: "Remove",
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
        { id: "rename", label: "Rename…", icon: "drive_file_rename_outline" },
        { id: "open", label: "Open", icon: "open_in_new" },
        ...(isRemote(a.location)
          ? []
          : [{ id: "reveal", label: "Reveal in Finder", icon: "folder_open" }]),
        { id: "remove", label: "Remove", icon: "delete", danger: true, dividerAbove: true },
      ],
      onPick: (id) => {
        if (id === "rename") renameAttachment(a);
        if (id === "open") api.openAttachment(a);
        if (id === "reveal") api.revealAttachment(a);
        if (id === "remove") removeAttachment(a);
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 animate-rise flex-col">
      <div className="relative shrink-0 border-b border-hairline p-4 pb-3">
        {/* Index tick: the panel "receives" the selection. */}
        <span className="absolute left-0 top-[19px] h-4 w-0.5 bg-accent" />
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5">
            <DoneCheckbox done={task.done} size={18} onToggle={() => onToggleDone(task)} />
          </div>
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") {
                    setTitleDraft(task.title);
                    setEditingTitle(false);
                  }
                }}
                className="-mx-1 w-[calc(100%+8px)] rounded bg-recessed px-1 font-display text-[18px] font-semibold leading-6 text-ink outline-none"
              />
            ) : (
              <button
                onClick={() => {
                  setTitleDraft(task.title);
                  setEditingTitle(true);
                }}
                title="Click to edit"
                className="block w-full text-left font-display text-[18px] font-semibold leading-6 text-ink"
              >
                {task.title}
              </button>
            )}
            <div className="mt-2.5 flex flex-col gap-1 text-[11.5px] tabular-nums text-ink-3">
              <span className="flex items-center gap-1.5">
                <Icon name="folder_open" size={13} weight={300} className="shrink-0 text-ink-3" />
                <span className="truncate text-ink-2">{projectName ?? "—"}</span>
                {listName && <span className="shrink-0 text-ink-3">/ {listName}</span>}
              </span>
              <span className="flex items-center gap-1.5" title={absoluteDateTime(task.created_at)}>
                <Icon name="schedule" size={13} weight={300} className="shrink-0 text-ink-3" />
                Created {relativeTime(task.created_at)}
              </span>
              <span className="flex items-center gap-1.5" title={absoluteDateTime(task.updated_at)}>
                <Icon name="update" size={13} weight={300} className="shrink-0 text-ink-3" />
                Updated {relativeTime(task.updated_at)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close panel"
            className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-wash hover:text-ink"
          >
            <Icon name="last_page" size={16} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="p-4">
          <SectionHeader
            label="Notes"
            trailing={
              notes.length > 0 ? (
                <span className="text-[11px] tabular-nums text-ink-3">{notes.length}</span>
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

            <RichTextEditor
              ref={addNoteRef}
              placeholder="Write a note…  (drop an attachment to @mention it)"
              minHeightClass="min-h-24"
              attachments={task.attachments}
              onOpenMention={openMention}
              onSubmit={addNote}
            />
            <button
              onClick={addNote}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-active"
            >
              <Icon name="add" size={16} />
              Add note
              <span className="text-[11px] font-medium opacity-70">⌘⏎</span>
            </button>
          </div>
        </div>

        {children.length > 0 && (
          <div className="px-4 pb-4">
            <SectionHeader
              label="Subtasks"
              trailing={
                <span className="text-[11.5px] tabular-nums text-ink-3">
                  {doneChildren} done / {children.length}
                </span>
              }
            />
            {children.map((child) => (
              <div
                key={child.id}
                className="-mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-1.5 hover:bg-wash"
              >
                <DoneCheckbox done={child.done} size={14} onToggle={() => onToggleDone(child)} />
                <button
                  onClick={() => onSelectTask(child.id)}
                  title={child.title}
                  className={`min-w-0 flex-1 truncate text-left text-[13.5px] ${
                    child.done ? "text-ink-3 line-through" : "text-ink"
                  }`}
                >
                  {child.title}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="p-4">
          <SectionHeader
            label="Attachments"
            trailing={
              <div className="flex items-center gap-0.5">
                <button
                  onClick={addScreenshot}
                  title="Capture the full screen and attach it"
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-wash hover:text-ink"
                >
                  <Icon name="screenshot_monitor" size={14} />
                  Shot
                </button>
                <button
                  onClick={addLink}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-wash hover:text-ink"
                >
                  <Icon name="add_link" size={14} />
                  Link
                </button>
                <button
                  onClick={addFile}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-wash hover:text-ink"
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
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="group relative block aspect-square w-full overflow-hidden rounded-lg border border-hairline bg-raised transition-colors hover:border-hairline-strong"
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
                            className="text-ink-3"
                          />
                        </span>
                      )}
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-raised text-ink-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <Icon name="open_in_full" size={14} />
                      </span>
                    </button>
                    <div className="mt-1 truncate text-center text-[11px] text-ink-3">
                      {a.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-auto border-t border-hairline-faint p-4">
          <button
            onClick={() => onRequestDelete(task)}
            className="flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-soft"
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
    <div className="flex h-full flex-col overflow-hidden bg-window">
      {task ? (
        <TaskInspector key={task.id} {...props} task={task} />
      ) : (
        <div className="flex flex-1 animate-rise flex-col items-center justify-center gap-1.5 px-6 text-center">
          <Icon name="left_click" size={28} weight={200} className="mb-1 text-ink-3" />
          <p className="font-display text-[17px] font-medium text-ink-2">No task selected</p>
          <p className="text-[13px] text-ink-3">Select a task to inspect it</p>
        </div>
      )}
    </div>
  );
}
