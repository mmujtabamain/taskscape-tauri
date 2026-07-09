import { useEffect, useState } from 'react';
import { api, type Attachment } from '../api';
import {
  attachmentSrc,
  fileKindFor,
  isRemote,
  previewKindFor,
} from '../lib/fileKind';
import { confirmModal } from '../lib/modal';
import { Icon } from './Icon';

interface AttachmentViewerProps {
  attachment: Attachment;
  onClose: () => void;
  onDeleted: () => void;
}

const TEXT_PREVIEW_CAP = 262144;

function IconButton({
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
    <button
      onClick={onClick}
      title={title}
      className={`rounded-field text-content-3l dark:text-content-3d grid h-6 w-6 shrink-0 place-items-center transition-colors ${
        danger
          ? 'hover:bg-danger-100l dark:hover:bg-danger-100d hover:text-danger-500l dark:hover:text-danger-500d'
          : 'hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d'
      }`}
    >
      <Icon name={name} size={14} />
    </button>
  );
}

export function AttachmentViewer({
  attachment,
  onClose,
  onDeleted,
}: AttachmentViewerProps) {
  const kind = fileKindFor(attachment.name, attachment.location);
  const preview = previewKindFor(attachment);
  const remote = isRemote(attachment.location);

  const [src, setSrc] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [text, setText] = useState<string | null>(null);
  const [textFailed, setTextFailed] = useState(false);
  // The asset protocol only serves files under its configured scope; a
  // reference pointing outside it fails to load — degrade to the "Open" card
  // rather than a broken <img>/<embed>.
  const [mediaFailed, setMediaFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setResolving(true);
    setSrc(null);
    setMediaFailed(false);
    attachmentSrc(attachment).then((s) => {
      if (!alive) return;
      setSrc(s);
      setResolving(false);
    });
    return () => {
      alive = false;
    };
  }, [attachment]);

  useEffect(() => {
    if (preview !== 'text' || !src) return;
    let alive = true;
    setText(null);
    setTextFailed(false);
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((t) => {
        if (alive)
          setText(
            t.length > TEXT_PREVIEW_CAP ? `${t.slice(0, TEXT_PREVIEW_CAP)}…` : t
          );
      })
      .catch(() => {
        if (alive) setTextFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [preview, src]);

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

  const loading = (
    <div className="text-content-3l dark:text-content-3d py-6 text-center text-[11px]">
      Loading…
    </div>
  );

  const noneCard = (
    <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
      <Icon
        name={kind.icon}
        size={24}
        className="text-content-3l dark:text-content-3d"
      />
      <div className="text-content-1l dark:text-content-1d max-w-full truncate text-[12px]">
        {attachment.name}
      </div>
      <div className="text-content-3l dark:text-content-3d text-[11px]">
        No inline preview
      </div>
      <button
        onClick={() => api.openAttachment(attachment)}
        className="rounded-field text-content-2l dark:text-content-2d hover:bg-wash-1l dark:hover:bg-wash-1d hover:text-content-1l dark:hover:text-content-1d mt-1 flex h-7 items-center gap-1.5 px-3 text-[12px] font-semibold transition-colors"
      >
        <Icon name="open_in_new" size={14} />
        Open
      </button>
    </div>
  );

  const renderBody = () => {
    if (resolving) return loading;
    if (!src || mediaFailed) return noneCard;
    switch (preview) {
      case 'image':
        return (
          <img
            src={src}
            alt={attachment.name}
            draggable={false}
            onError={() => setMediaFailed(true)}
            onClick={() => api.openAttachment(attachment)}
            className="max-h-[260px] w-full cursor-pointer object-contain"
            title="Open full size"
          />
        );
      case 'video':
        return (
          <video
            controls
            src={src}
            onError={() => setMediaFailed(true)}
            className="max-h-[260px] w-full"
          />
        );
      case 'audio':
        return (
          <audio
            controls
            src={src}
            onError={() => setMediaFailed(true)}
            className="w-full"
          />
        );
      case 'pdf':
        return (
          <embed
            src={src}
            type="application/pdf"
            className="h-[260px] w-full"
          />
        );
      case 'text':
        if (textFailed) return noneCard;
        if (text === null) return loading;
        return (
          <pre className="text-content-2l dark:text-content-2d max-h-[260px] overflow-auto p-3 text-[11px] leading-4 break-words whitespace-pre-wrap select-text">
            {text}
          </pre>
        );
      default:
        return noneCard;
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 pb-1.5">
        <Icon
          name={kind.icon}
          size={14}
          className="text-content-3l dark:text-content-3d shrink-0"
        />
        <span
          className="text-content-1l dark:text-content-1d min-w-0 flex-1 truncate text-[12px]"
          title={attachment.name}
        >
          {attachment.name}
        </span>
        <IconButton
          name="open_in_new"
          title="Open"
          onClick={() => api.openAttachment(attachment)}
        />
        {!remote && (
          <IconButton
            name="folder_open"
            title="Reveal in Finder"
            onClick={() => api.revealAttachment(attachment)}
          />
        )}
        <IconButton
          name="delete"
          title="Remove attachment"
          danger
          onClick={remove}
        />
        <IconButton name="close" title="Close preview" onClick={onClose} />
      </div>
      <div className="rounded-field border-edge-2l dark:border-edge-2d bg-surface-3l dark:bg-surface-3d max-h-[260px] overflow-hidden border">
        {renderBody()}
      </div>
    </div>
  );
}
