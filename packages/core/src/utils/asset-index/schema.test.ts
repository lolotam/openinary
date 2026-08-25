import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureAssetIndexSchema } from "./schema";
import { SqliteAssetIndex } from "./store";

function seed(index: SqliteAssetIndex, path: string, extra: Partial<{
  filename: string;
  mediaType: "image" | "video" | "raw";
  folder: string;
}> = {}) {
  return index.upsertFromUpload({
    path,
    filename: extra.filename ?? path.slice(path.lastIndexOf("/") + 1),
    size: 10,
    mime: "image/jpeg",
    mediaType: extra.mediaType ?? "image",
    folder: extra.folder ?? (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""),
    contentHash: null,
    thumbnailPath: null,
    customMetadata: {},
    mtime: Date.now(),
  });
}

test("ensureAssetIndexSchema creates tables and FTS matches inserts", () => {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  assert.equal(ftsAvailable, true);

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('assets', 'folder_covers', 'assets_fts')",
    )
    .all() as { name: string }[];
  assert.deepEqual(
    tables.map((t) => t.name).sort(),
    ["assets", "assets_fts", "folder_covers"],
  );

  const index = new SqliteAssetIndex(db, ftsAvailable);
  seed(index, "hello.jpg");
  const result = index.search({ q: "hello" });
  assert.equal(result.degraded, false);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, "hello.jpg");
});

test("insert before FTS create is picked up by rebuild", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      media_type TEXT NOT NULL,
      folder TEXT NOT NULL,
      content_hash TEXT,
      thumbnail_path TEXT,
      custom_metadata TEXT NOT NULL DEFAULT '{}',
      mtime INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO assets (id, path, filename, size, mime, media_type, folder, custom_metadata, created_at, updated_at)
     VALUES ('id-1', 'before.jpg', 'before.jpg', 1, 'image/jpeg', 'image', '', '{}', 1, 1)`,
  ).run();

  const { ftsAvailable } = ensureAssetIndexSchema(db);
  assert.equal(ftsAvailable, true);

  const index = new SqliteAssetIndex(db, ftsAvailable);
  const result = index.search({ q: "before" });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, "before.jpg");
});

test("missing trigger recovery drops FTS, recreates, and rebuilds", () => {
  const db = new Database(":memory:");
  ensureAssetIndexSchema(db);
  const index = new SqliteAssetIndex(db, true);
  seed(index, "recover.jpg");

  db.exec("DROP TRIGGER assets_ai");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  assert.equal(ftsAvailable, true);

  const triggers = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('assets_ai','assets_ad','assets_au')",
    )
    .all() as { name: string }[];
  assert.equal(triggers.length, 3);

  const recovered = new SqliteAssetIndex(db, true);
  const result = recovered.search({ q: "recover" });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, "recover.jpg");
});
