import { useEffect, useState } from "react";
import { api, type Attachment } from "../api";
import { attachmentSrc, fileKindFor, isRemote, previewKindFor, splitFileName } from "../lib/fileKind";
import { confirmModal, promptName } from "../lib/modal";
import { propagateAttachmentRename } from "../lib/mentions";
import { setOverlay } from "../lib/overlays";
import { Icon } from "./Icon";

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
    <button
      onClick={onClick}
      title={title}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/70 transition-colors ${
        danger ? "hover:bg-danger hover:text-white" : "hover:bg-white/15 hover:text-white"
      }`}
    >
      <Icon name={name} size={17} />
    </button>
  );
}

/** Full-window lightbox for inspecting an attachment. Arrow keys / on-screen
 *  chevrons step through the task's attachments; Escape or a backdrop click
 *  dismisses it. */
export function AttachmentLightbox({ attachments, index, onIndex, onClose, onDeleted, onRenamed }: Props) {
  const attachment = attachments[index];
  const count = attachments.length;
  const [src, setSrc] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [text, setText] = useState<string | null>(null);
  const [textFailed, setTextFailed] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);

  const kind = attachment ? fileKindFor(attachment.name, attachment.location) : null;
  const preview = attachment ? previewKindFor(attachment) : "none";
  const remote = attachment ? isRemote(attachment.location) : false;

  const step = (delta: number) => {
    if (count > 1) onIndex((index + delta + count) % count);
  };

  // Own the window's arrow/Escape keys while open (capture phase so the app's
  // task-navigation handler never also fires), and defer selection-clearing.
  useEffect(() => {
    setOverlay(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.stopPropagation();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.stopPropagation();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      setOverlay(false);
      window.removeEventListener("keydown", onKey, true);
    };
  });

  useEffect(() => {
    if (!attachment) return;
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
    if (preview !== "text" || !src) return;
    let alive = true;
    setText(null);
    setTextFailed(false);
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((t) => {
        if (alive) setText(t.length > TEXT_PREVIEW_CAP ? `${t.slice(0, TEXT_PREVIEW_CAP)}…` : t);
      })
      .catch(() => {
        if (alive) setTextFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [preview, src]);

  if (!attachment || !kind) return null;

  const remove = async () => {
    const ok = await confirmModal({
      danger: true,
      title: "Remove attachment?",
      message: attachment.name,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await api.deleteAttachment(attachment.id);
    onDeleted();
  };

  const rename = async () => {
    const { base, ext } = splitFileName(attachment.name);
    const name = await promptName({
      title: "Rename attachment",
      icon: "drive_file_rename_outline",
      message: remote
        ? "Renames the reference label; the linked file is untouched."
        : "The stored file is renamed to match.",
      initialValue: base,
      suffix: ext ? `.${ext}` : undefined,
      confirmLabel: "Rename",
    });
    if (!name || name === attachment.name) return;
    const updated = await api.renameAttachment(attachment.id, name);
    await propagateAttachmentRename(attachment.task_id, attachment.name, updated.name);
    onRenamed();
  };

  const card = (label: string) => (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-content px-10 py-12 text-center">
      <Icon name={kind.icon} size={44} weight={200} className="text-ink-3" />
      <div className="max-w-xs truncate text-[14px] text-ink">{attachment.name}</div>
      <div className="text-[12px] text-ink-3">{label}</div>
      <button
        onClick={() => api.openAttachment(attachment)}
        className="mt-1 flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover"
      >
        <Icon name="open_in_new" size={15} />
        Open externally
      </button>
    </div>
  );

  const body = () => {
    if (resolving) return <div className="text-[13px] text-white/60">Loading…</div>;
    if (!src || mediaFailed) return card("No inline preview");
    switch (preview) {
      case "image":
        return (
          <img
            src={src}
            alt={attachment.name}
            draggable={false}
            onError={() => setMediaFailed(true)}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        );
      case "video":
        return (
          <video
            controls
            autoPlay
            src={src}
            onError={() => setMediaFailed(true)}
            className="max-h-full max-w-full rounded-lg shadow-2xl"
          />
        );
      case "audio":
        return (
          <div className="rounded-xl bg-content px-8 py-10">
            <Icon name={kind.icon} size={40} weight={200} className="mx-auto mb-4 block text-ink-3" />
            <audio controls autoPlay src={src} onError={() => setMediaFailed(true)} />
          </div>
        );
      case "pdf":
        return <embed src={src} type="application/pdf" className="h-full w-full max-w-4xl rounded-lg" />;
      case "text":
        if (textFailed) return card("Couldn’t read this file");
        if (text === null) return <div className="text-[13px] text-white/60">Loading…</div>;
        return (
          <pre className="max-h-full w-full max-w-3xl select-text overflow-auto rounded-lg bg-content p-5 text-[12.5px] leading-5 text-ink-2">
            {text}
          </pre>
        );
      default:
        return card("No inline preview");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-13 shrink-0 items-center gap-2 px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name={kind.icon} size={16} className="shrink-0 text-white/70" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-white" title={attachment.name}>
          {attachment.name}
        </span>
        {count > 1 && (
          <span className="mr-1 shrink-0 text-[12px] tabular-nums text-white/55">
            {index + 1} / {count}
          </span>
        )}
        <BarButton name="open_in_new" title="Open externally" onClick={() => api.openAttachment(attachment)} />
        {!remote && (
          <BarButton
            name="folder_open"
            title="Reveal in Finder"
            onClick={() => api.revealAttachment(attachment)}
          />
        )}
        <BarButton name="drive_file_rename_outline" title="Rename" onClick={rename} />
        <BarButton name="delete" title="Remove attachment" danger onClick={remove} />
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
              className="absolute left-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              <Icon name="chevron_left" size={26} weight={300} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              title="Next"
              className="absolute right-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
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
    </div>
  );
}
