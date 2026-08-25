import { Hono } from "hono";
import fs from "fs";
import path from "path";
import type { RouteDeps } from "../config/deps";
import {
  canonicalizeStoragePath,
  getMediaType,
  isCoverInsideFolder,
} from "../utils/storage-level";
import logger, { serializeError } from "../utils/logger";

async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function coverExistsAsFile(
  coverPath: string,
  storage: RouteDeps["storage"],
): Promise<boolean> {
  if (storage) {
    return storage.existsOriginal(coverPath);
  }

  const publicRoot = path.resolve("./public");
  const resolved = path.resolve(publicRoot, coverPath);
  const relative = path.relative(publicRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  try {
    return fs.statSync(resolved).isFile();
  } catch {
    return false;
  }
}

export function createFolderThumbnailRoute(deps: RouteDeps) {
  const route = new Hono();

  route.post("/thumbnail", async (c) => {
    if (!deps.assetIndex) {
      return c.json({ error: "Asset index unavailable" }, 503);
    }

    const body = await readJsonBody(c);
    const folderRaw = typeof body.folder === "string" ? body.folder : undefined;
    const pathRaw = typeof body.path === "string" ? body.path : undefined;

    if (folderRaw === undefined || pathRaw === undefined) {
      return c.json({ error: "folder and path are required" }, 400);
    }

    const folder = canonicalizeStoragePath(folderRaw);
    const coverPath = canonicalizeStoragePath(pathRaw);
    if (folder === null || coverPath === null || !coverPath) {
      return c.json({ error: "Invalid folder or path" }, 400);
    }

    if (!isCoverInsideFolder(folder, coverPath)) {
      return c.json({ error: "Cover path must be inside the folder" }, 400);
    }

    if (getMediaType(coverPath) !== "image") {
      return c.json({ error: "Cover must be an image" }, 400);
    }

    const exists = await coverExistsAsFile(coverPath, deps.storage);
    if (!exists) {
      return c.json({ error: "Cover file not found" }, 404);
    }

    try {
      deps.assetIndex.setCover(folder, coverPath);
    } catch (error) {
      logger.error(
        { error: serializeError(error), folder, coverPath },
        "Failed to set folder cover",
      );
      return c.json({ error: "Failed to set folder cover" }, 500);
    }

    return c.json({ ok: true, folder, coverPath });
  });

  route.delete("/thumbnail", async (c) => {
    if (!deps.assetIndex) {
      return c.json({ error: "Asset index unavailable" }, 503);
    }

    const body = await readJsonBody(c);
    const folderRaw =
      typeof body.folder === "string"
        ? body.folder
        : (c.req.query("folder") ?? undefined);

    if (folderRaw === undefined) {
      return c.json({ error: "folder is required" }, 400);
    }

    const folder = canonicalizeStoragePath(folderRaw);
    if (folder === null) {
      return c.json({ error: "Invalid folder" }, 400);
    }

    try {
      deps.assetIndex.clearCover(folder);
    } catch (error) {
      logger.error(
        { error: serializeError(error), folder },
        "Failed to clear folder cover",
      );
      return c.json({ error: "Failed to clear folder cover" }, 500);
    }

    return c.json({ ok: true, folder, coverPath: null });
  });

  return route;
}
