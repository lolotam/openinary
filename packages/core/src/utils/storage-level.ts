import { assetKindForExt } from "./upload-validation";

export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".psd",
  ".heic",
  ".heif",
];

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

export type MediaType = "image" | "video" | "raw";

export type FolderPreviewItem = { path: string; type: MediaType };

export type LevelFile = {
  name: string;
  path: string;
  size?: number;
  mtime?: string;
};

export type LevelFolder = {
  name: string;
  path: string;
  coverPath?: string | null;
};

export type FolderSummary = {
  itemCount: number;
  truncated: boolean;
  previewItems: FolderPreviewItem[];
  coverPath?: string | null;
};

type ListedObject = { key: string; size?: number; lastModified?: Date };

export const FOLDER_SUMMARY_MAX_KEYS = 100;
export const FOLDER_PREVIEW_LIMIT = 4;

export function getMediaType(name: string): MediaType | null {
  const lower = name.toLowerCase();
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "video";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const kind = assetKindForExt(ext);
  if (kind === "audio" || kind === "model" || kind === "raw") return "raw";
  return null;
}

/**
 * Normalizes a user-provided folder path.
 * Returns "" for the root, null when the path is invalid (empty segments,
 * "." or "..", critical to prevent traversal in the local-FS fallback).
 */
export function normalizeLevelPath(raw: string): string | null {
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";

  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      return null;
    }
  }
  return segments.join("/");
}

/**
 * Canonical posix storage path: relative, no drive letter, no UNC, no `..`.
 * Returns "" for the bucket/root, null when the path is unsafe.
 */
export function canonicalizeStoragePath(raw: string): string | null {
  const posix = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(posix) || posix.startsWith("//") || posix.startsWith("/")) {
    return null;
  }
  return normalizeLevelPath(posix);
}

/**
 * Cover image `path` must be a file inside `folder`. Never `path === folder`.
 * Root (`folder === ""`): cover has no `/`. Nested: cover starts with `folder + "/"`.
 */
export function isCoverInsideFolder(folder: string, coverPath: string): boolean {
  if (!coverPath || coverPath === folder) return false;
  if (folder === "") return !coverPath.includes("/");
  return coverPath.startsWith(`${folder}/`);
}

export function parentFolderOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "" : filePath.slice(0, i);
}

/**
 * Shapes one delimiter-listed directory level into folder names and files.
 * `storagePrefix` is the raw listing prefix (e.g. "public/cows/"), `folderPath`
 * the relative path of the listed folder ("" for root). The folder marker
 * object (key === storagePrefix) is excluded.
 */
export function shapeLevel(
  storagePrefix: string,
  folderPath: string,
  delimited: { prefixes: string[]; objects: ListedObject[] },
): { folderNames: string[]; files: LevelFile[] } {
  const folderNames = delimited.prefixes
    .map((prefix) => prefix.slice(storagePrefix.length).replace(/\/+$/, ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const files = delimited.objects
    .filter((obj) => obj.key !== storagePrefix)
    .map((obj) => {
      const name = obj.key.slice(storagePrefix.length);
      return {
        name,
        path: folderPath ? `${folderPath}/${name}` : name,
        size: obj.size,
        mtime: obj.lastModified?.toISOString(),
      };
    })
    .filter((file) => file.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { folderNames, files };
}

/**
 * Shapes a bounded single-page listing of a folder into its summary:
 * direct child count (capped by the page size), truncation flag and up to
 * FOLDER_PREVIEW_LIMIT media preview items.
 */
export function shapeFolderSummary(
  storagePrefix: string,
  folderPath: string,
  page: { prefixes: string[]; objects: ListedObject[]; isTruncated: boolean },
  previewLimit = FOLDER_PREVIEW_LIMIT,
): FolderSummary {
  const children = page.objects.filter((obj) => obj.key !== storagePrefix);

  const previewItems: FolderPreviewItem[] = [];
  for (const obj of children) {
    if (previewItems.length >= previewLimit) break;
    const name = obj.key.slice(storagePrefix.length);
    const type = getMediaType(name);
    if (type === "image" || type === "video") {
      previewItems.push({
        path: folderPath ? `${folderPath}/${name}` : name,
        type,
      });
    }
  }

  return {
    itemCount: page.prefixes.length + children.length,
    truncated: page.isTruncated,
    previewItems,
  };
}

/**
 * Derives every folder path (including intermediate ones) from a flat list of
 * relative keys. Marker keys ("a/b/") count as folders themselves.
 */
export function deriveFolderPaths(keys: string[]): string[] {
  const folders = new Set<string>();

  for (const key of keys) {
    const normalized = key.replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    const dirDepth = normalized.endsWith("/") ? parts.length : parts.length - 1;

    for (let i = 1; i <= dirDepth; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  return [...folders].sort((a, b) => a.localeCompare(b));
}
