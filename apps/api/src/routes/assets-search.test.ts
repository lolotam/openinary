import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import Database from "better-sqlite3";
import {
  createAssetsSearchRoute,
  ensureAssetIndexSchema,
  SqliteAssetIndex,
} from "@openinary/core";

function makeApp() {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  const assetIndex = new SqliteAssetIndex(db, ftsAvailable);
  const app = new Hono();
  app.route(
    "/assets",
    createAssetsSearchRoute({
      storage: null,
      queue: {} as any,
      assetIndex,
    }),
  );
  return { app, assetIndex };
}

function seed(
  index: SqliteAssetIndex,
  filePath: string,
  mediaType: "image" | "video" | "raw" = "image",
) {
  const folder = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/"))
    : "";
  index.upsertFromUpload({
    path: filePath,
    filename: filePath.slice(filePath.lastIndexOf("/") + 1),
    size: 1,
    mime: "image/jpeg",
    mediaType,
    folder,
    contentHash: null,
    thumbnailPath: null,
    customMetadata: {},
    mtime: Date.now(),
  });
}

test("GET /assets/search finds seeded assets and filters by type and folder", async () => {
  const { app, assetIndex } = makeApp();
  seed(assetIndex, "a_b/one.jpg");
  seed(assetIndex, "a_b/clip.mp4", "video");
  seed(assetIndex, "aXb/two.jpg");

  const all = await app.request("/assets/search?q=one");
  assert.equal(all.status, 200);
  const allJson = await all.json();
  assert.equal(allJson.degraded, false);
  assert.equal(allJson.results.length, 1);
  assert.equal(allJson.results[0].path, "a_b/one.jpg");

  const videos = await app.request("/assets/search?q=clip&type=video");
  assert.equal((await videos.json()).results[0].mediaType, "video");

  const folder = await app.request("/assets/search?q=jpg&folder=a_b");
  const folderJson = await folder.json();
  const paths = folderJson.results.map((r: { path: string }) => r.path);
  assert.ok(paths.includes("a_b/one.jpg"));
  assert.equal(paths.includes("aXb/two.jpg"), false);
});

test("GET /assets/search rejects missing q, traversal, and bad cursor", async () => {
  const { app } = makeApp();

  const missing = await app.request("/assets/search");
  assert.equal(missing.status, 400);

  const empty = await app.request("/assets/search?q=");
  assert.equal(empty.status, 400);

  const traversal = await app.request("/assets/search?q=cat&folder=../etc");
  assert.equal(traversal.status, 400);

  const badCursor = await app.request("/assets/search?q=cat&cursor=%%%");
  assert.equal(badCursor.status, 400);
});

test("GET /assets/search returns degraded empty results when index is missing", async () => {
  const app = new Hono();
  app.route(
    "/assets",
    createAssetsSearchRoute({ storage: null, queue: {} as any }),
  );
  const res = await app.request("/assets/search?q=hello");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    results: [],
    nextCursor: null,
    degraded: true,
  });
});
