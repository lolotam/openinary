import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureAssetIndexSchema } from "./schema";
import { SqliteAssetIndex } from "./store";
import { reconcileAssetIndex } from "./reconcile";

function makeIndex() {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  return new SqliteAssetIndex(db, ftsAvailable);
}

function seedFile(
  index: SqliteAssetIndex,
  filePath: string,
  size = 1,
  mtime = 1,
) {
  const folder = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/"))
    : "";
  index.upsertFromUpload({
    path: filePath,
    filename: filePath.slice(filePath.lastIndexOf("/") + 1),
    size,
    mime: "image/jpeg",
    mediaType: "image",
    folder,
    contentHash: null,
    thumbnailPath: null,
    customMetadata: {},
    mtime,
  });
}

test("local reconcile upserts files and removes rows missing from disk", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asset-index-local-"));
  try {
    writeFileSync(path.join(root, "a.jpg"), "aa");
    writeFileSync(path.join(root, "b.jpg"), "bb");
    mkdirSync(path.join(root, "sub"));
    writeFileSync(path.join(root, "sub", "c.jpg"), "cc");

    const index = makeIndex();
    const first = await reconcileAssetIndex({
      storage: null,
      localRoot: root,
      index,
    });
    assert.equal(first.mode, "local");
    assert.equal(first.upserted, 3);
    assert.equal(first.removed, 0);
    assert.ok(index.getByPath("a.jpg"));
    assert.ok(index.getByPath("sub/c.jpg"));

    rmSync(path.join(root, "b.jpg"));
    const second = await reconcileAssetIndex({
      storage: null,
      localRoot: root,
      index,
    });
    assert.equal(second.removed, 1);
    assert.equal(index.getByPath("b.jpg"), null);
    assert.ok(index.getByPath("a.jpg"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local walk throw does not delete existing index rows", async () => {
  const index = makeIndex();
  seedFile(index, "keep.jpg");
  await assert.rejects(() =>
    reconcileAssetIndex({
      storage: null,
      localRoot: path.join(tmpdir(), "asset-index-missing-" + Date.now()),
      index,
    }),
  );
  assert.ok(index.getByPath("keep.jpg"));
});

test("S3 listing omit does not delete index rows", async () => {
  const index = makeIndex();
  seedFile(index, "listed.jpg", 4, 1000);
  seedFile(index, "omitted.jpg", 5, 2000);

  const storage = {
    listAllParallel: async () => [
      {
        key: "public/listed.jpg",
        size: 4,
        lastModified: new Date(1000),
      },
    ],
  } as any;

  const result = await reconcileAssetIndex({
    storage,
    localRoot: "./public",
    index,
  });
  assert.equal(result.mode, "s3-upsert");
  assert.equal(result.removed, 0);
  assert.ok(index.getByPath("listed.jpg"));
  assert.ok(index.getByPath("omitted.jpg"));
});

test("S3 listing throw does not mass-delete", async () => {
  const index = makeIndex();
  seedFile(index, "keep.jpg");
  const storage = {
    listAllParallel: async () => {
      throw new Error("s3 down");
    },
  } as any;

  await assert.rejects(() =>
    reconcileAssetIndex({
      storage,
      localRoot: "./public",
      index,
    }),
  );
  assert.ok(index.getByPath("keep.jpg"));
});
