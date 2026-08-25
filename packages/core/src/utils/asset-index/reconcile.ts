import { promises as fs } from "fs";
import path from "path";
import { contentTypeForExt } from "../upload-validation";
import {
  canonicalizeStoragePath,
  getMediaType,
  parentFolderOf,
} from "../storage-level";
import type { CloudStorage } from "../storage/cloud-storage";
import type { AssetIndex } from "./types";

export type ReconcileResult = {
  upserted: number;
  removed: number;
  durationMs: number;
  mode: "local" | "s3-upsert";
};

const BATCH_YIELD = 50;

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function mimeForPath(filePath: string): string {
  const ext = path.posix.extname(filePath).slice(1);
  return contentTypeForExt(ext);
}

function isDotPath(relPath: string): boolean {
  return relPath.split("/").some((segment) => segment.startsWith("."));
}

function relativeFromPublicKey(key: string): string | null {
  const stripped = key.replace(/^\/+/, "");
  const relative = stripped.startsWith("public/")
    ? stripped.slice("public/".length)
    : stripped;
  if (!relative || relative.endsWith("/")) return null;
  return canonicalizeStoragePath(relative);
}

async function upsertIfChanged(
  index: AssetIndex,
  filePath: string,
  size: number,
  mtime: number | null,
): Promise<boolean> {
  const mediaType = getMediaType(filePath);
  if (!mediaType) return false;

  const existing = index.getByPath(filePath);
  if (
    existing &&
    existing.size === size &&
    existing.mtime === mtime
  ) {
    return false;
  }

  index.upsertFromUpload({
    path: filePath,
    filename: filePath.slice(filePath.lastIndexOf("/") + 1),
    size,
    mime: mimeForPath(filePath),
    mediaType,
    folder: parentFolderOf(filePath),
    contentHash: existing?.contentHash ?? null,
    thumbnailPath: null,
    customMetadata: existing?.customMetadata ?? {},
    mtime,
  });
  return true;
}

async function walkLocal(
  absDir: string,
  relDir: string,
  index: AssetIndex,
  seen: Set<string>,
  counters: { upserted: number; entries: number },
): Promise<void> {
  const entries = await fs.readdir(absDir, { withFileTypes: true });

  for (const entry of entries) {
    counters.entries += 1;
    if (counters.entries > 0 && counters.entries % BATCH_YIELD === 0) {
      await yieldEventLoop();
    }

    if (entry.name.startsWith(".")) continue;

    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      await walkLocal(absPath, relPath, index, seen, counters);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isDotPath(relPath)) continue;

    const canonical = canonicalizeStoragePath(relPath);
    if (!canonical) continue;

    const stat = await fs.stat(absPath);
    const mtime = Math.round(stat.mtimeMs);
    seen.add(canonical);
    if (await upsertIfChanged(index, canonical, stat.size, mtime)) {
      counters.upserted += 1;
    }
  }
}

async function reconcileLocal(
  localRoot: string,
  index: AssetIndex,
): Promise<{ upserted: number; removed: number }> {
  const seen = new Set<string>();
  const counters = { upserted: 0, entries: 0 };
  await walkLocal(localRoot, "", index, seen, counters);

  let removed = 0;
  for (const stored of index.iterPaths(500)) {
    if (!seen.has(stored)) {
      index.removeByPath(stored);
      removed += 1;
    }
  }
  index.clearCoversMissingFrom?.(seen);
  return { upserted: counters.upserted, removed };
}

async function reconcileS3(
  storage: CloudStorage,
  index: AssetIndex,
): Promise<{ upserted: number }> {
  const objects = await storage.listAllParallel("public/");
  let upserted = 0;

  for (let i = 0; i < objects.length; i++) {
    if (i > 0 && i % BATCH_YIELD === 0) {
      await yieldEventLoop();
    }

    const obj = objects[i];
    const canonical = relativeFromPublicKey(obj.key);
    if (!canonical) continue;
    if (isDotPath(canonical)) continue;

    const size = obj.size ?? 0;
    const mtime = obj.lastModified ? obj.lastModified.getTime() : null;
    if (await upsertIfChanged(index, canonical, size, mtime)) {
      upserted += 1;
    }
  }

  return { upserted };
}

export async function reconcileAssetIndex(opts: {
  storage: CloudStorage | null;
  localRoot: string;
  index: AssetIndex;
}): Promise<ReconcileResult> {
  const started = Date.now();

  if (opts.storage) {
    const { upserted } = await reconcileS3(opts.storage, opts.index);
    return {
      upserted,
      removed: 0,
      durationMs: Date.now() - started,
      mode: "s3-upsert",
    };
  }

  const { upserted, removed } = await reconcileLocal(
    opts.localRoot,
    opts.index,
  );
  return {
    upserted,
    removed,
    durationMs: Date.now() - started,
    mode: "local",
  };
}
