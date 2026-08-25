import type { MediaType } from "./types";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".psd"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];
const RAW_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".ogg",
  ".glb",
  ".gltf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".html",
  ".htm",
  ".json",
  ".xml",
  ".csv",
  ".txt",
  ".md",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
];

export function getMediaType(name: string): MediaType | null {
  const lower = name.toLowerCase();
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "video";
  if (RAW_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "raw";
  return null;
}
