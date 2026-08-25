import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureAssetIndexSchema } from "./schema";
import { SqliteAssetIndex } from "./store";
import { encodeSearchCursor } from "./fts-query";

function makeIndex() {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  return { db, index: new SqliteAssetIndex(db, ftsAvailable) };
}

function upsert(
  index: SqliteAssetIndex,
  path: string,
  opts: {
    mediaType?: "image" | "video" | "raw";
    size?: number;
    mtime?: number;
    metadata?: Record<string, unknown>;
    id?: string;
  } = {},
) {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return index.upsertFromUpload({
    id: opts.id,
    path,
    filename: path.slice(path.lastIndexOf("/") + 1),
    size: opts.size ?? 10,
    mime:
      opts.mediaType === "video"
        ? "video/mp4"
        : opts.mediaType === "raw"
          ? "application/zip"
          : "image/jpeg",
    mediaType: opts.mediaType ?? "image",
    folder,
    contentHash: "abc",
    thumbnailPath: null,
    customMetadata: opts.metadata ?? {},
    mtime: opts.mtime ?? 1,
  });
}

test("upsert inserts and same-path update keeps id", () => {
  const { index } = makeIndex();
  const first = upsert(index, "a.jpg", { size: 1, mtime: 10 });
  const second = upsert(index, "a.jpg", { size: 2, mtime: 20 });
  assert.equal(first.id, second.id);
  assert.equal(second.size, 2);
  assert.equal(second.mtime, 20);
  assert.equal(index.getByPath("a.jpg")?.size, 2);
});

test("search finds filename and supports type filter", () => {
  const { index } = makeIndex();
  upsert(index, "cat.jpg", { mediaType: "image" });
  upsert(index, "clip.mp4", { mediaType: "video" });
  upsert(index, "notes.zip", { mediaType: "raw" });

  const all = index.search({ q: "cat" });
  assert.equal(all.results.length, 1);
  assert.equal(all.results[0].filename, "cat.jpg");

  const videos = index.search({ q: "clip", type: "video" });
  assert.equal(videos.results.length, 1);

  const imagesNamedClip = index.search({ q: "clip", type: "image" });
  assert.equal(imagesNamedClip.results.length, 0);
});

test("folder prefix with underscore does not match siblings", () => {
  const { index } = makeIndex();
  upsert(index, "a_b/one.jpg");
  upsert(index, "aXb/two.jpg");
  upsert(index, "a_b/nested/three.jpg");

  const result = index.search({ q: "jpg", folder: "a_b" });
  const paths = result.results.map((r) => r.path).sort();
  assert.deepEqual(paths, ["a_b/nested/three.jpg", "a_b/one.jpg"]);
});

test("removeByPath deletes the asset and covers pointing at it", () => {
  const { index } = makeIndex();
  upsert(index, "album/cover.jpg");
  index.setCover("album", "album/cover.jpg");
  index.removeByPath("album/cover.jpg");
  assert.equal(index.getByPath("album/cover.jpg"), null);
  assert.equal(index.getCover("album"), null);
});

test("removeByFolderPrefix deletes nested assets and covers", () => {
  const { index } = makeIndex();
  upsert(index, "album/a.jpg");
  upsert(index, "album/sub/b.jpg");
  upsert(index, "other/c.jpg");
  index.setCover("album", "album/a.jpg");
  index.setCover("album/sub", "album/sub/b.jpg");
  index.removeByFolderPrefix("album");
  assert.equal(index.getByPath("album/a.jpg"), null);
  assert.equal(index.getByPath("album/sub/b.jpg"), null);
  assert.equal(index.getByPath("other/c.jpg")?.path, "other/c.jpg");
  assert.equal(index.getCover("album"), null);
  assert.equal(index.getCover("album/sub"), null);
});

test("same-folder movePath rewrites cover_path", () => {
  const { index } = makeIndex();
  upsert(index, "album/old.jpg");
  index.setCover("album", "album/old.jpg");
  index.movePath("album/old.jpg", "album/new.jpg");
  assert.equal(index.getByPath("album/old.jpg"), null);
  assert.equal(index.getByPath("album/new.jpg")?.filename, "new.jpg");
  assert.equal(index.getCover("album"), "album/new.jpg");
});

test("cross-folder movePath clears the cover row", () => {
  const { index } = makeIndex();
  upsert(index, "album/hero.jpg");
  index.setCover("album", "album/hero.jpg");
  index.movePath("album/hero.jpg", "other/hero.jpg");
  assert.equal(index.getByPath("other/hero.jpg")?.folder, "other");
  assert.equal(index.getCover("album"), null);
});

test("copyPath clones a row and does not copy covers", () => {
  const { index } = makeIndex();
  upsert(index, "album/hero.jpg", { size: 42 });
  index.setCover("album", "album/hero.jpg");
  index.copyPath("album/hero.jpg", "album/hero copy.jpg");
  assert.equal(index.getByPath("album/hero.jpg")?.size, 42);
  assert.equal(index.getByPath("album/hero copy.jpg")?.size, 42);
  assert.equal(index.getCover("album"), "album/hero.jpg");
});

test("moveFolderPrefix rewrites assets and covers", () => {
  const { index } = makeIndex();
  upsert(index, "old/a.jpg");
  upsert(index, "old/sub/b.jpg");
  index.setCover("old", "old/a.jpg");
  index.setCover("old/sub", "old/sub/b.jpg");
  index.moveFolderPrefix("old", "new");
  assert.equal(index.getByPath("old/a.jpg"), null);
  assert.equal(index.getByPath("new/a.jpg")?.folder, "new");
  assert.equal(index.getByPath("new/sub/b.jpg")?.folder, "new/sub");
  assert.equal(index.getCover("new"), "new/a.jpg");
  assert.equal(index.getCover("new/sub"), "new/sub/b.jpg");
  assert.equal(index.getCover("old"), null);
});

test("set get and clear cover", () => {
  const { index } = makeIndex();
  index.setCover("", "hero.jpg");
  assert.equal(index.getCover(""), "hero.jpg");
  assert.equal(index.coversFor([""]).get(""), "hero.jpg");
  index.clearCover("");
  assert.equal(index.getCover(""), null);
});

test("invalid cursor throws from search", () => {
  const { index } = makeIndex();
  upsert(index, "a.jpg");
  assert.throws(() => index.search({ q: "a", cursor: "%%%" }), /invalid_cursor/);
});

test("search pagination uses updated_at+id cursor", () => {
  const { index } = makeIndex();
  const a = upsert(index, "a.jpg", { id: "id-a" });
  const b = upsert(index, "b.jpg", { id: "id-b" });
  const first = index.search({ q: "jpg", limit: 1 });
  assert.equal(first.results.length, 1);
  assert.ok(first.nextCursor);
  const second = index.search({ q: "jpg", limit: 1, cursor: first.nextCursor! });
  assert.equal(second.results.length, 1);
  assert.notEqual(first.results[0].id, second.results[0].id);
  assert.ok([a.id, b.id].includes(first.results[0].id));
});

test("MATCH errors return degraded empty results", () => {
  const { db, index } = makeIndex();
  upsert(index, "ok.jpg");
  db.exec("DROP TABLE assets_fts");
  const result = index.search({ q: "ok" });
  assert.deepEqual(result, {
    results: [],
    nextCursor: null,
    degraded: true,
  });
});

test("iterPaths keyset pagination still yields remaining rows after deletes", () => {
  const { index } = makeIndex();
  upsert(index, "a.jpg");
  upsert(index, "b.jpg");
  upsert(index, "c.jpg");
  const seen: string[] = [];
  for (const p of index.iterPaths(1)) {
    seen.push(p);
    if (p === "b.jpg") index.removeByPath(p);
  }
  assert.deepEqual(seen, ["a.jpg", "b.jpg", "c.jpg"]);
});

test("encodeSearchCursor is accepted by search", () => {
  const { index } = makeIndex();
  const row = upsert(index, "z.jpg", { id: "zzz" });
  const cursor = encodeSearchCursor(row.updatedAt, row.id);
  const result = index.search({ q: "z", cursor });
  assert.equal(result.results.length, 0);
});
