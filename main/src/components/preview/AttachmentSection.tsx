import { ATTACHMENT_MIME } from '@taskscape/common-ui/attachmentMime';
import {
  Divider,
  Label,
  SectionHeader,
  ToolbarButton,
} from '@taskscape/common-ui/components';
import {
  attachmentSrc,
  fileKindFor,
  isRemote,
  splitFileName,
} from '@taskscape/common-ui/fileKind';
import { Icon } from '@taskscape/common-ui/Icon';
import { Spinner } from '@taskscape/common-ui/Spinner';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { api, type Attachment, type Task } from '../../api';
import { propagateAttachmentRename } from '../../lib/mentions';
import { confirmModal, openModal, promptName } from '../../lib/modal';
import { useContextMenu } from '../contextMenuContext';

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

/** The inspector's Attachments section: the tile grid (with image thumbnails)
 *  plus the add-file / add-link / screenshot affordances. Owns its thumbnail
 *  cache and capture state; the lightbox lives in the parent inspector (shared
 *  with note @mentions), opened via `onOpenLightbox`. */
export function AttachmentSection({
  task,
  onRefresh,
  onOpenLightbox,
}: {
  task: Task;
  onRefresh: () => void;
  onOpenLightbox: (index: number) => void;
}) {
  const menu = useContextMenu();
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [capturing, setCapturing] = useState(false);

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
    else onOpenLightbox(task.attachments.findIndex((x) => x.id === a.id));
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
    <div className="p-4 pt-0">
      <SectionHeader
        label="Attachments"
        trailing={
          <div className="gap-space-1 flex items-center">
            <ToolbarButton
              onClick={addScreenshot}
              disabled={capturing}
              title={
                capturing
                  ? 'Capturing …'
                  : 'Capture the full screen and attach it'
              }
              className="disabled:cursor-default disabled:hover:bg-transparent"
            >
              {capturing ? (
                <Spinner size={12} />
              ) : (
                <Icon name="screenshot_monitor" size={14} />
              )}
              {capturing ? 'Capturing …' : 'Shot'}
            </ToolbarButton>
            <ToolbarButton icon="add_link" iconSize={14} onClick={addLink}>
              Link
            </ToolbarButton>
            <ToolbarButton icon="note_add" iconSize={14} onClick={addFile}>
              File
            </ToolbarButton>
          </div>
        }
      />

      {task.attachments.length > 0 ? (
        <div className="gap-space-4 grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))]">
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
                  className="group rounded-control border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d hover:border-edge-3l dark:hover:border-edge-3d relative block aspect-square w-full overflow-hidden border"
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
                  <span className="bg-surface-3l dark:bg-surface-3d text-content-2l dark:text-content-2d absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full opacity-0 group-hover:opacity-100">
                    <Icon name="open_in_full" size={14} />
                  </span>
                </button>
                <Label
                  as="div"
                  tone="muted"
                  truncate
                  className="mt-1 text-center text-[11px]"
                >
                  {a.name}
                </Label>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-control bg-surface-3l dark:bg-surface-3d border-edge-3l dark:border-edge-3d gap-space-2 p-space-2 flex h-20 w-full items-stretch border border-dashed">
          <button
            onClick={addFile}
            title="Copy a file into this task"
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-2l dark:hover:text-content-2d gap-space-2 flex flex-1 flex-col items-center justify-center text-[12.5px] font-semibold"
          >
            <Icon name="note_add" size={18} />
            Copy a file
          </button>
          <Divider orientation="vertical" level={2} className="my-2" />
          <button
            onClick={addLink}
            title="Link a file or URL without copying"
            className="rounded-field text-content-3l dark:text-content-3d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-2l dark:hover:text-content-2d gap-space-2 flex flex-1 flex-col items-center justify-center text-[12.5px] font-semibold"
          >
            <Icon name="add_link" size={18} />
            Add a link
          </button>
        </div>
      )}
    </div>
  );
}
