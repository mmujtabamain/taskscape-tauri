import { convertFileSrc } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import type { Attachment } from "../api";

export type FileKindLabel =
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "text"
  | "csv"
  | "archive"
  | "image"
  | "audio"
  | "video"
  | "code"
  | "link"
  | "file";

export interface FileKind {
  label: FileKindLabel;
  /** Material Symbols glyph. */
  icon: string;
}

const KIND: Record<FileKindLabel, FileKind> = {
  pdf: { label: "pdf", icon: "picture_as_pdf" },
  word: { label: "word", icon: "description" },
  excel: { label: "excel", icon: "table_chart" },
  powerpoint: { label: "powerpoint", icon: "slideshow" },
  text: { label: "text", icon: "article" },
  csv: { label: "csv", icon: "csv" },
  archive: { label: "archive", icon: "folder_zip" },
  image: { label: "image", icon: "image" },
  audio: { label: "audio", icon: "music_note" },
  video: { label: "video", icon: "movie" },
  code: { label: "code", icon: "code" },
  link: { label: "link", icon: "link" },
  file: { label: "file", icon: "draft" },
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "ico"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"]);
const VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm", "avi", "mkv"]);
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "dmg"]);
const TEXT_EXTS = new Set(["txt", "log", "md", "markdown", "rtf"]);
const CODE_EXTS = new Set([
  "js", "jsx", "ts", "tsx", "py", "java", "c", "cc", "cpp", "h", "hpp", "cs", "go",
  "rb", "php", "rs", "kt", "swift", "html", "css", "scss", "json", "xml", "yml",
  "yaml", "toml", "sh", "bash", "sql",
]);

export function extensionOf(name: string): string {
  const dot = (name || "").lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isRemote(location: string): boolean {
  return /^https?:\/\//i.test(location.trim());
}

export function fileKindFor(name: string, location?: string): FileKind {
  if (location && isRemote(location)) return KIND.link;
  const ext = extensionOf(name);
  if (ext === "pdf") return KIND.pdf;
  if (ext === "doc" || ext === "docx") return KIND.word;
  if (ext === "xls" || ext === "xlsx") return KIND.excel;
  if (ext === "ppt" || ext === "pptx") return KIND.powerpoint;
  if (ext === "csv") return KIND.csv;
  if (ARCHIVE_EXTS.has(ext)) return KIND.archive;
  if (IMAGE_EXTS.has(ext)) return KIND.image;
  if (AUDIO_EXTS.has(ext)) return KIND.audio;
  if (VIDEO_EXTS.has(ext)) return KIND.video;
  if (CODE_EXTS.has(ext)) return KIND.code;
  if (TEXT_EXTS.has(ext)) return KIND.text;
  return KIND.file;
}

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "none";

export function previewKindFor(a: Attachment): PreviewKind {
  if (isRemote(a.location)) return "none";
  const ext = extensionOf(a.name);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (TEXT_EXTS.has(ext) || CODE_EXTS.has(ext) || ext === "csv") return "text";
  return "none";
}

/** Absolute filesystem path for a local attachment, or null when remote/opaque. */
export async function attachmentPath(a: Attachment): Promise<string | null> {
  if (a.link_type === "copy") return join(await homeDir(), ".taskscape", a.location);
  const loc = a.location.trim();
  if (isRemote(loc)) return null;
  if (loc.startsWith("file://")) return decodeURI(loc.slice("file://".length));
  if (loc.startsWith("/") || /^[A-Za-z]:[\\/]/.test(loc)) return loc;
  return null;
}

/** Webview-loadable asset URL for a local attachment, or null. */
export async function attachmentSrc(a: Attachment): Promise<string | null> {
  const path = await attachmentPath(a);
  return path ? convertFileSrc(path) : null;
}
