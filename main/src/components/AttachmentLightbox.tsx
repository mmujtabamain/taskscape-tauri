import { Icon } from '@taskscape/common-ui/Icon';
import {
  Backdrop,
  Button,
  IconButton,
  Label,
} from '@taskscape/common-ui/components';
import {
  attachmentSrc,
  fileKindFor,
  isRemote,
  previewKindFor,
  splitFileName,
} from '@taskscape/common-ui/fileKind';
import { useEffect, useState } from 'react';
import { api, type Attachment } from '../api';
import { propagateAttachmentRename } from '../lib/mentions';
import { confirmModal, promptName } from '../lib/modal';
import { setOverlay } from '../lib/overlays';
import { SelectableText } from './SelectableText';

const TEXT_PREVIEW_CAP = 262144;

interface Props {
  attachments: Attachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDeleted: () => void;
  onRenamed: () => void;
}

function BarButton({
  name,
  title,
  danger = false,
  onClick,
}: {
  name: string;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      icon={name}
      size="xl"
      radius="control"
      iconSize={17}
      variant="onMedia"
      onClick={onClick}
      title={title}
      className={
        danger
          ? 'hover:bg-danger-500l dark:hover:bg-danger-500d hover:text-white'
          : undefined
      }
    />
  );
}

/** Full-window lightbox for inspecting an attachment. Arrow keys / on-screen
 *  chevrons step through the task's attachments; Escape or a backdrop click
 *  dismisses it. */
export function AttachmentLightbox({
  attachments,
  index,
  onIndex,
  onClose,
  onDeleted,
  onRenamed,
}: Props) {
  const attachment = attachments[index];
  const count = attachments.length;
  // Async results are tagged with the attachment (or src) they belong to, so a
  // stale result is ignored by a render-time identity check instead of resetting
  // state synchronously inside the effect when the input changes.
  const [resolved, setResolved] = useState<{
    id: string;
    src: string | null;
  } | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [loadedText, setLoadedText] = useState<{
    src: string;
    text: string | null;
    failed: boolean;
  } | null>(null);

  const resolving = !attachment || resolved?.id !== attachment.id;
  const src =
    attachment && resolved && resolved.id === attachment.id
      ? resolved.src
      : null;
  const mediaFailed = !!attachment && failedId === attachment.id;
  const textForSrc = loadedText && loadedText.src === src ? loadedText : null;
  const text = textForSrc ? textForSrc.text : null;
  const textFailed = textForSrc ? textForSrc.failed : false;

  const kind = attachment
    ? fileKindFor(attachment.name, attachment.location)
    : null;
  const preview = attachment ? previewKindFor(attachment) : 'none';
  const remote = attachment ? isRemote(attachment.location) : false;

  const step = (delta: number) => {
    if (count > 1) onIndex((index + delta + count) % count);
  };

  // Own the window's arrow/Escape keys while open (capture phase so the app's
  // task-navigation handler never also fires), and defer selection-clearing.
  useEffect(() => {
    setOverlay(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation();
        step(1);
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      setOverlay(false);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  useEffect(() => {
    if (!attachment) return;
    let alive = true;
    attachmentSrc(attachment).then((s) => {
      if (alive) setResolved({ id: attachment.id, src: s });
    });
    return () => {
      alive = false;
    };
  }, [attachment]);

  useEffect(() => {
    if (preview !== 'text' || !src) return;
    let alive = true;
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((t) => {
        if (alive)
          setLoadedText({
            src,
            text:
              t.length > TEXT_PREVIEW_CAP
                ? `${t.slice(0, TEXT_PREVIEW_CAP)}…`
                : t,
            failed: false,
          });
      })
      .catch(() => {
        if (alive) setLoadedText({ src, text: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [preview, src]);

  if (!attachment || !kind) return null;

  const remove = async () => {
    const ok = await confirmModal({
      danger: true,
      title: 'Remove attachment?',
      message: attachment.name,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.deleteAttachment(attachment.id);
    onDeleted();
  };

  const rename = async () => {
    const { base, ext } = splitFileName(attachment.name);
    const name = await promptName({
      title: 'Rename attachment',
      icon: 'drive_file_rename_outline',
      message: remote
        ? 'Renames the reference label; the linked file is untouched.'
        : 'The stored file is renamed to match.',
      initialValue: base,
      suffix: ext ? `.${ext}` : undefined,
      confirmLabel: 'Rename',
    });
    if (!name || name === attachment.name) return;
    const updated = await api.renameAttachment(attachment.id, name);
    await propagateAttachmentRename(
      attachment.task_id,
      attachment.name,
      updated.name
    );
    onRenamed();
  };

  const card = (label: string) => (
    <div className="rounded-panel bg-surface-2l dark:bg-surface-2d gap-space-5 flex flex-col items-center px-10 py-12 text-center">
      <Icon
        name={kind.icon}
        size={44}
        weight={200}
        className="text-content-3l dark:text-content-3d"
      />
      <Label as="div" tone="primary" truncate className="max-w-xs text-[14px]">
        {attachment.name}
      </Label>
      <Label as="div" tone="muted" className="text-[12px]">
        {label}
      </Label>
      <Button
        variant="primary"
        className="gap-space-3 mt-1"
        onClick={() => api.openAttachment(attachment)}
      >
        <Icon name="open_in_new" size={15} />
        Open externally
      </Button>
    </div>
  );

  const body = () => {
    if (resolving)
      return <div className="text-[13px] text-white/60">Loading…</div>;
    if (!src || mediaFailed) return card('No inline preview');
    switch (preview) {
      case 'image':
        return (
          <img
            src={src}
            alt={attachment.name}
            draggable={false}
            onError={() => setFailedId(attachment.id)}
            className="rounded-control max-h-full max-w-full object-contain shadow-2xl"
          />
        );
      case 'video':
        return (
          <video
            controls
            autoPlay
            src={src}
            onError={() => setFailedId(attachment.id)}
            className="rounded-control max-h-full max-w-full shadow-2xl"
          />
        );
      case 'audio':
        return (
          <div className="rounded-panel bg-surface-2l dark:bg-surface-2d px-8 py-10">
            <Icon
              name={kind.icon}
              size={40}
              weight={200}
              className="text-content-3l dark:text-content-3d mx-auto mb-4 block"
            />
            <audio
              controls
              autoPlay
              src={src}
              onError={() => setFailedId(attachment.id)}
            />
          </div>
        );
      case 'pdf':
        return (
          <embed
            src={src}
            type="application/pdf"
            className="rounded-control h-full w-full max-w-4xl"
          />
        );
      case 'text':
        if (textFailed) return card('Couldn’t read this file');
        if (text === null)
          return <div className="text-[13px] text-white/60">Loading…</div>;
        return (
          <SelectableText
            as="pre"
            className="rounded-control bg-surface-2l dark:bg-surface-2d text-content-2l dark:text-content-2d max-h-full w-full max-w-3xl overflow-auto p-5 text-[12.5px] leading-5"
          >
            {text}
          </SelectableText>
        );
      default:
        return card('No inline preview');
    }
  };

  return (
    <Backdrop dim="75" blur className="flex flex-col" onClick={onClose}>
      <div
        className="gap-space-4 px-space-7 flex h-13 shrink-0 items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name={kind.icon} size={16} className="shrink-0 text-white/70" />
        <span
          className="min-w-0 flex-1 truncate text-[13.5px] text-white"
          title={attachment.name}
        >
          {attachment.name}
        </span>
        {count > 1 && (
          <span className="mr-1 shrink-0 text-[12px] text-white/55 tabular-nums">
            {index + 1} / {count}
          </span>
        )}
        <BarButton
          name="open_in_new"
          title="Open externally"
          onClick={() => api.openAttachment(attachment)}
        />
        {!remote && (
          <BarButton
            name="folder_open"
            title="Reveal in Finder"
            onClick={() => api.revealAttachment(attachment)}
          />
        )}
        <BarButton
          name="drive_file_rename_outline"
          title="Rename"
          onClick={rename}
        />
        <BarButton
          name="delete"
          title="Remove attachment"
          danger
          onClick={remove}
        />
        <BarButton name="close" title="Close  Esc" onClick={onClose} />
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-8"
        onClick={onClose}
      >
        {count > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              title="Previous"
              className="absolute left-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
            >
              <Icon name="chevron_left" size={26} weight={300} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              title="Next"
              className="absolute right-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
            >
              <Icon name="chevron_right" size={26} weight={300} />
            </button>
          </>
        )}
        <div
          className="flex max-h-full max-w-full items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {body()}
        </div>
      </div>
    </Backdrop>
  );
}
