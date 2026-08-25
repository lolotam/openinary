import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { ensureAssetIndexSchema } from "../utils/asset-index/schema";
import { SqliteAssetIndex } from "../utils/asset-index/store";
import { createAssetsSearchRoute } from "./assets-search";

function appWithIndex() {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  const assetIndex = new SqliteAssetIndex(db, ftsAvailable);
  const app = new Hono();
  app.route("/assets", createAssetsSearchRoute({ storage: null, queue: {} as any, assetIndex }));
  return { app, assetIndex };
}

function seed(
  index: SqliteAssetIndex,
  path: string,
  mediaType: "image" | "video" | "raw" = "image",
) {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  index.upsertFromUpload({
    path,
    filename: path.slice(path.lastIndexOf("/") + 1),
    size: 1,
    mime: "image/jpeg",
    mediaType,
    folder,
    contentHash: null,
    thumbnailPath: null,
    customMetadata: { tag: "alpha" },
    mtime: 1,
  });
}

test("GET /assets/search finds filename, type, and folder", async () => {
  const { app, assetIndex } = appWithIndex();
  seed(assetIndex, "a_b/cat.jpg", "image");
  seed(assetIndex, "a_b/clip.mp4", "video");
  seed(assetIndex, "aXb/dog.jpg", "image");

  const res = await app.request("/assets/search?q=cat");
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.degraded, false);
  assert.equal(json.results.length, 1);
  assert.equal(json.results[0].path, "a_b/cat.jpg");

  const videos = await app.request("/assets/search?q=clip&type=video");
  assert.equal((await videos.json()).results[0].path, "a_b/clip.mp4");

  const folder = await app.request("/assets/search?q=jpg&folder=a_b");
  const paths = (await folder.json()).results.map((r: { path: string }) => r.path).sort();
  assert.deepEqual(paths, ["a_b/cat.jpg"]);
});

test("GET /assets/search rejects empty q, bad type, traversal, and bad cursor", async () => {
  const { app } = appWithIndex();
  assert.equal((await app.request("/assets/search")).status, 400);
  assert.equal((await app.request("/assets/search?q=   ")).status, 400);
  assert.equal((await app.request("/assets/search?q=cat&type=nope")).status, 400);
  assert.equal((await app.request("/assets/search?q=cat&folder=../etc")).status, 400);
  assert.equal((await app.request("/assets/search?q=cat&cursor=%%%")).status, 400);
});

test("GET /assets/search degrades when index is missing", async () => {
  const app = new Hono();
  app.route("/assets", createAssetsSearchRoute({ storage: null, queue: {} as any }));
  const res = await app.request("/assets/search?q=cat");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    results: [],
    nextCursor: null,
    degraded: true,
  });
});
