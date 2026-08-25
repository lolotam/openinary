import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteAssetCompletely } from "./asset-deletion";

test("S3 folder early return unindexes by prefix", async () => {
  const removedFolders: string[] = [];
  const removedPaths: string[] = [];
  const storage = {
    existsOriginal: async () => false,
    folderExists: async () => true,
    deleteFolder: async () => 4,
  } as any;
  const jobStore = {
    deleteJobsByFilePath: () => {
      throw new Error("should not delete jobs on folder early return");
    },
  } as any;
  const assetIndex = {
    removeByFolderPrefix(folder: string) {
      removedFolders.push(folder);
    },
    removeByPath(path: string) {
      removedPaths.push(path);
    },
  } as any;

  const result = await deleteAssetCompletely(
    "album",
    storage,
    jobStore,
    assetIndex,
  );

  assert.equal(result.success, true);
  assert.equal(result.originalFileDeleted, true);
  assert.deepEqual(removedFolders, ["album"]);
  assert.deepEqual(removedPaths, []);
});

test("S3 file delete unindexes by path", async () => {
  const removedFolders: string[] = [];
  const removedPaths: string[] = [];
  const storage = {
    existsOriginal: async () => true,
    deleteAllCachedTransformations: async () => 0,
    deleteOriginal: async () => {},
    invalidateAllCacheEntries: () => {},
  } as any;
  const jobStore = { deleteJobsByFilePath: () => 0 } as any;
  const assetIndex = {
    removeByFolderPrefix(folder: string) {
      removedFolders.push(folder);
    },
    removeByPath(path: string) {
      removedPaths.push(path);
    },
  } as any;

  const result = await deleteAssetCompletely(
    "album/hero.jpg",
    storage,
    jobStore,
    assetIndex,
  );
  assert.equal(result.originalFileDeleted, true);
  assert.deepEqual(removedPaths, ["album/hero.jpg"]);
  assert.deepEqual(removedFolders, []);
});

test("index throw after storage delete does not fail the result", async () => {
  const storage = {
    existsOriginal: async () => false,
    folderExists: async () => true,
    deleteFolder: async () => 1,
  } as any;
  const result = await deleteAssetCompletely("album", storage, {} as any, {
    removeByFolderPrefix() {
      throw new Error("index down");
    },
    removeByPath() {},
  } as any);
  assert.equal(result.success, true);
  assert.equal(result.originalFileDeleted, true);
});
