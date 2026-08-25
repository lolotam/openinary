import { Hono } from "hono";
import type { RouteDeps } from "../config/deps";
import {
  decodeSearchCursor,
  sanitizeFtsQuery,
} from "../utils/asset-index/fts-query";
import { canonicalizeStoragePath } from "../utils/storage-level";
import type { MediaType } from "../utils/storage-level";

const MEDIA_TYPES = new Set<MediaType>(["image", "video", "raw"]);

export function createAssetsSearchRoute(deps: RouteDeps) {
  const route = new Hono();

  route.get("/search", async (c) => {
    const q = c.req.query("q") ?? "";
    if (!q.trim()) {
      return c.json({ error: "q is required" }, 400);
    }
    if (!sanitizeFtsQuery(q)) {
      return c.json({ error: "q is required" }, 400);
    }

    const typeRaw = c.req.query("type");
    let type: MediaType | undefined;
    if (typeRaw !== undefined && typeRaw !== "") {
      if (!MEDIA_TYPES.has(typeRaw as MediaType)) {
        return c.json({ error: "Invalid type" }, 400);
      }
      type = typeRaw as MediaType;
    }

    const folderRaw = c.req.query("folder");
    let folder: string | undefined;
    if (folderRaw !== undefined) {
      const canonical = canonicalizeStoragePath(folderRaw);
      if (canonical === null) {
        return c.json({ error: "Invalid folder" }, 400);
      }
      folder = canonical;
    }

    const limitRaw = c.req.query("limit");
    let limit = 25;
    if (limitRaw !== undefined && limitRaw !== "") {
      if (!/^\d+$/.test(limitRaw)) {
        return c.json({ error: "Invalid limit" }, 400);
      }
      limit = Number(limitRaw);
      if (limit < 1 || limit > 100) {
        return c.json({ error: "Invalid limit" }, 400);
      }
    }

    const cursorRaw = c.req.query("cursor");
    if (cursorRaw) {
      if (!decodeSearchCursor(cursorRaw)) {
        return c.json({ error: "Invalid cursor" }, 400);
      }
    }

    if (!deps.assetIndex) {
      return c.json({ results: [], nextCursor: null, degraded: true });
    }

    try {
      const result = deps.assetIndex.search({
        q,
        type,
        folder,
        limit,
        cursor: cursorRaw,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_cursor") {
        return c.json({ error: "Invalid cursor" }, 400);
      }
      return c.json({ results: [], nextCursor: null, degraded: true });
    }
  });

  return route;
}
