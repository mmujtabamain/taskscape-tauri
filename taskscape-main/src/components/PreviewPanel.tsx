import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Attachment, type Task, type TaskPatch } from "../api";
import { attachmentSrc, fileKindFor, isRemote } from "../lib/fileKind";
import { openModal } from "../lib/modal";
import { absoluteDateTime, relativeTime } from "../time";
import { AttachmentViewer } from "./AttachmentViewer";
import { Icon } from "./Icon";

interface PreviewPanelProps {
  task: Task | null;
  childrenByParent: Record<string, Task[]>;
  listName: string | null;
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

function DoneCheckbox({
  done,
  size,
  onToggle,
}: {
  done: boolean;
  size: 14 | 18;
  onToggle: () => void;
}) {
  const box = size === 18 ? "h-[18px] w-[18px] rounded-[5px]" : "h-3.5 w-3.5 rounded-[4px]";
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
      {done && <Icon name="check" size={size === 18 ? 12 : 10} weight={700} />}
    </button>
  );
}

type InspectorProps = Omit<PreviewPanelProps, "task"> & { task: Task };

function TaskInspector({
  task,
  childrenByParent,
  listName,
  onUpdateTask,
  onToggleDone,
  onSelectTask,
  onRequestDelete,
  onRefresh,
  onClose,
}: InspectorProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());

  const children = childrenByParent[task.id] ?? [];
  const doneChildren = children.filter((c) => c.done).length;
  const selectedAttachment = task.attachments.find((a) => a.id === selectedAttachmentId) ?? null;

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

  const commitNotes = () => {
    if (notesDraft !== (task.notes ?? "")) onUpdateTask(task.id, { notes: notesDraft });
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
    else setSelectedAttachmentId(a.id);
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
                className="-mx-1 w-[calc(100%+8px)] rounded bg-recessed px-1 font-display text-[17px] font-semibold leading-[22px] text-ink outline-none"
              />
            ) : (
              <button
                onClick={() => {
                  setTitleDraft(task.title);
                  setEditingTitle(true);
                }}
                title="Click to edit"
                className="block w-full text-left font-display text-[17px] font-semibold leading-[22px] text-ink"
              >
                {task.title}
              </button>
            )}
            <div className="mt-1 truncate text-[11px] tabular-nums text-ink-3">
              {listName && <>in {listName} · </>}
              <span title={absoluteDateTime(task.created_at)}>
                created {relativeTime(task.created_at)}
              </span>
              {" · "}
              <span title={absoluteDateTime(task.updated_at)}>
                updated {relativeTime(task.updated_at)}
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
          <SectionHeader label="Notes" />
          <div className="-mx-2">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={commitNotes}
              placeholder="Add notes…"
              className="block min-h-24 w-full resize-y rounded-md bg-transparent px-2 py-1.5 text-[13px] leading-5 text-ink transition-colors placeholder:text-ink-3 focus:bg-recessed"
            />
          </div>
        </div>

        {children.length > 0 && (
          <div className="px-4 pb-4">
            <SectionHeader
              label="Subtasks"
              trailing={
                <span className="text-[11px] tabular-nums text-ink-3">
                  {doneChildren} done / {children.length}
                </span>
              }
            />
            {children.map((child) => (
              <div
                key={child.id}
                className="-mx-1.5 flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-wash"
              >
                <DoneCheckbox done={child.done} size={14} onToggle={() => onToggleDone(child)} />
                <button
                  onClick={() => onSelectTask(child.id)}
                  title={child.title}
                  className={`min-w-0 flex-1 truncate text-left text-[12.5px] ${
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
                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-ink-3 transition-colors hover:bg-wash hover:text-ink"
                >
                  <Icon name="screenshot_monitor" size={13} />
                  Shot
                </button>
                <button
                  onClick={addLink}
                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-ink-3 transition-colors hover:bg-wash hover:text-ink"
                >
                  <Icon name="add_link" size={13} />
                  Link
                </button>
                <button
                  onClick={addFile}
                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-ink-3 transition-colors hover:bg-wash hover:text-ink"
                >
                  <Icon name="note_add" size={13} />
                  File
                </button>
              </div>
            }
          />

          {selectedAttachment && (
            <div className="mb-3 animate-rise">
              <AttachmentViewer
                key={selectedAttachment.id}
                attachment={selectedAttachment}
                onClose={() => setSelectedAttachmentId(null)}
                onDeleted={() => {
                  setSelectedAttachmentId(null);
                  onRefresh();
                }}
              />
            </div>
          )}

          {task.attachments.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
              {task.attachments.map((a) => {
                const thumb = thumbs.get(a.id);
                return (
                  <div key={a.id} className="min-w-0">
                    <button
                      onClick={() => openTile(a)}
                      title={a.name}
                      className="group relative block aspect-square w-full overflow-hidden rounded border border-hairline bg-raised transition-colors hover:border-hairline-strong"
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
                            size={20}
                            className="text-ink-3"
                          />
                        </span>
                      )}
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-raised text-ink-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <Icon name="open_in_full" size={14} />
                      </span>
                    </button>
                    <div className="mt-1 truncate text-center text-[10.5px] text-ink-3">
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
            className="flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-danger transition-colors hover:bg-danger-soft"
          >
            <Icon name="delete" size={14} />
            Delete task
          </button>
        </div>
      </div>
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
        <div className="flex flex-1 animate-rise flex-col items-center justify-center gap-1 px-6 text-center">
          <Icon name="left_click" size={24} weight={200} className="mb-1 text-ink-3" />
          <p className="font-display text-[15px] font-medium text-ink-2">No task selected</p>
          <p className="text-[12px] text-ink-3">Select a task to inspect it</p>
        </div>
      )}
    </div>
  );
}
