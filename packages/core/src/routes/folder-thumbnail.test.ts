import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { ensureAssetIndexSchema } from "../utils/asset-index/schema";
import { SqliteAssetIndex } from "../utils/asset-index/store";
import { createFolderThumbnailRoute } from "./folder-thumbnail";

function appWith(exists: Record<string, boolean> = {}) {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  const assetIndex = new SqliteAssetIndex(db, ftsAvailable);
  const storage = {
    existsOriginal: async (p: string) => Boolean(exists[p]),
  };
  const app = new Hono();
  app.route(
    "/folders",
    createFolderThumbnailRoute({
      storage: storage as any,
      queue: {} as any,
      assetIndex,
    }),
  );
  return { app, assetIndex };
}

test("POST /folders/thumbnail sets a nested and a root cover", async () => {
  const { app, assetIndex } = appWith({
    "album/hero.jpg": true,
    "hero.jpg": true,
  });

  const nested = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "album", path: "album/hero.jpg" }),
  });
  assert.equal(nested.status, 200, await nested.clone().text());
  assert.equal(assetIndex.getCover("album"), "album/hero.jpg");

  const root = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "", path: "hero.jpg" }),
  });
  assert.equal(root.status, 200);
  assert.equal(assetIndex.getCover(""), "hero.jpg");
});

test("POST /folders/thumbnail rejects outside folder, video, missing, and traversal", async () => {
  const { app } = appWith({
    "cats2/x.jpg": true,
    "album/clip.mp4": true,
  });

  const outside = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "cats", path: "cats2/x.jpg" }),
  });
  assert.equal(outside.status, 400);

  const video = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "album", path: "album/clip.mp4" }),
  });
  assert.equal(video.status, 400);

  const missing = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "album", path: "album/missing.jpg" }),
  });
  assert.equal(missing.status, 404);

  const traversal = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "album", path: "..\\etc\\hero.jpg" }),
  });
  assert.equal(traversal.status, 400);
});

test("DELETE /folders/thumbnail clears a cover", async () => {
  const { app, assetIndex } = appWith({ "hero.jpg": true });
  assetIndex.setCover("", "hero.jpg");
  const res = await app.request("/folders/thumbnail", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "" }),
  });
  assert.equal(res.status, 200);
  assert.equal(assetIndex.getCover(""), null);
});
