import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import Database from "better-sqlite3";
import {
  createFolderThumbnailRoute,
  ensureAssetIndexSchema,
  SqliteAssetIndex,
} from "@openinary/core";

function makeApp(storage: any = {
  existsOriginal: async (p: string) =>
    p === "hero.jpg" || p === "a/b/c.jpg" || p === "clip.mp4",
}) {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  const assetIndex = new SqliteAssetIndex(db, ftsAvailable);
  const app = new Hono();
  app.route(
    "/folders",
    createFolderThumbnailRoute({
      storage,
      queue: {} as any,
      assetIndex,
    }),
  );
  return { app, assetIndex };
}

test("POST /folders/thumbnail sets a nested cover and rejects outside or video", async () => {
  const { app, assetIndex } = makeApp();

  const ok = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "a/b", path: "a/b/c.jpg" }),
  });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual(await ok.json(), {
    ok: true,
    folder: "a/b",
    coverPath: "a/b/c.jpg",
  });
  assert.equal(assetIndex.getCover("a/b"), "a/b/c.jpg");

  const outside = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "cats", path: "cats2/x.jpg" }),
  });
  assert.equal(outside.status, 400);

  const video = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "", path: "clip.mp4" }),
  });
  assert.equal(video.status, 400);
});

test("POST /folders/thumbnail sets a root cover", async () => {
  const { app, assetIndex } = makeApp();
  const res = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "", path: "hero.jpg" }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(assetIndex.getCover(""), "hero.jpg");
});

test("POST /folders/thumbnail rejects Windows-style traversal", async () => {
  const { app } = makeApp();
  const res = await app.request("/folders/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "", path: "..\\etc\\passwd" }),
  });
  assert.equal(res.status, 400);
});

test("POST /folders/thumbnail rejects a directory named like an image", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "folder-thumb-"));
  const prev = process.cwd();
  try {
    mkdirSync(path.join(root, "public", "album.jpg"), { recursive: true });
    process.chdir(root);
    const { app } = makeApp(null);
    const res = await app.request("/folders/thumbnail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "", path: "album.jpg" }),
    });
    assert.equal(res.status, 404);
  } finally {
    process.chdir(prev);
    rmSync(root, { recursive: true, force: true });
  }
});

test("DELETE /folders/thumbnail clears a cover", async () => {
  const { app, assetIndex } = makeApp();
  assetIndex.setCover("a/b", "a/b/c.jpg");
  const res = await app.request("/folders/thumbnail", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "a/b" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    folder: "a/b",
    coverPath: null,
  });
  assert.equal(assetIndex.getCover("a/b"), null);
});

test("POST /folders/thumbnail accepts a real local image file", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "folder-thumb-file-"));
  const prev = process.cwd();
  try {
    mkdirSync(path.join(root, "public"), { recursive: true });
    writeFileSync(path.join(root, "public", "hero.jpg"), "jpg");
    process.chdir(root);
    const { app, assetIndex } = makeApp(null);
    const res = await app.request("/folders/thumbnail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "", path: "hero.jpg" }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(assetIndex.getCover(""), "hero.jpg");
  } finally {
    process.chdir(prev);
    rmSync(root, { recursive: true, force: true });
  }
});
