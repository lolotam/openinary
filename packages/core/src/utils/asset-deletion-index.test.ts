import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { deleteAssetCompletely } from "./asset-deletion";
import { ensureAssetIndexSchema } from "./asset-index/schema";
import { SqliteAssetIndex } from "./asset-index/store";

function makeIndex() {
  const db = new Database(":memory:");
  const { ftsAvailable } = ensureAssetIndexSchema(db);
  return new SqliteAssetIndex(db, ftsAvailable);
}

test("S3 folder early return unindexes the prefix", async () => {
  const index = makeIndex();
  index.upsertFromUpload({
    path: "album/a.jpg",
    filename: "a.jpg",
    size: 1,
    mime: "image/jpeg",
    mediaType: "image",
    folder: "album",
    contentHash: null,
    thumbnailPath: null,
    customMetadata: {},
    mtime: 1,
  });
  index.setCover("album", "album/a.jpg");

  const storage = {
    existsOriginal: async () => false,
    folderExists: async (p: string) => p === "album",
    deleteFolder: async () => 1,
  };

  const result = await deleteAssetCompletely(
    "album",
    storage as any,
    { deleteJobsByFilePath: () => 0 } as any,
    index,
  );
  assert.equal(result.success, true);
  assert.equal(index.getByPath("album/a.jpg"), null);
  assert.equal(index.getCover("album"), null);
});
