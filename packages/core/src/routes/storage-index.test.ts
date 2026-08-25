import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createStorageRoute } from "./storage";

function fakeIndex() {
  const calls: { op: string; args: unknown[] }[] = [];
  const covers = new Map<string, string>();
  return {
    calls,
    covers,
    index: {
      movePath: (...args: unknown[]) => calls.push({ op: "movePath", args }),
      moveFolderPrefix: (...args: unknown[]) =>
        calls.push({ op: "moveFolderPrefix", args }),
      copyPath: (...args: unknown[]) => calls.push({ op: "copyPath", args }),
      coversFor: (folders: string[]) => {
        const map = new Map<string, string>();
        for (const folder of folders) {
          const cover = covers.get(folder);
          if (cover) map.set(folder, cover);
        }
        return map;
      },
    } as any,
  };
}

function appFor(opts: {
  storage?: any;
  index?: any;
  queue?: any;
}) {
  const app = new Hono();
  app.route(
    "/storage",
    createStorageRoute({
      storage: opts.storage ?? null,
      queue: opts.queue ?? { getStore: () => ({}) },
      assetIndex: opts.index ?? null,
    } as any),
  );
  return app;
}

test("GET /storage attaches coverPath from the asset index", async () => {
  const { index, covers } = fakeIndex();
  covers.set("album", "album/hero.jpg");
  const app = appFor({
    index,
    storage: {
      listLevel: async () => ({
        folderNames: ["album", "empty"],
        files: [],
      }),
    },
  });

  const res = await app.request("/storage?path=");
  assert.equal(res.status, 200);
  const json = await res.json();
  const album = json.folders.find((f: { path: string }) => f.path === "album");
  const empty = json.folders.find((f: { path: string }) => f.path === "empty");
  assert.equal(album.coverPath, "album/hero.jpg");
  assert.equal(empty.coverPath, null);
});

test("PATCH rename file calls movePath after storage rename", async () => {
  const { index, calls } = fakeIndex();
  const renamed: string[] = [];
  const app = appFor({
    index,
    storage: {
      existsOriginalPath: async (p: string) => p === "album/old.jpg",
      folderExists: async () => false,
      renameOriginal: async (from: string, to: string) => {
        renamed.push(`${from}->${to}`);
      },
      invalidateAllCacheEntries: () => {},
    },
  });

  const res = await app.request("/storage/album/old.jpg", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "new.jpg" }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(renamed, ["album/old.jpg->album/new.jpg"]);
  assert.deepEqual(calls, [
    { op: "movePath", args: ["album/old.jpg", "album/new.jpg"] },
  ]);
});

test("PATCH rename folder calls moveFolderPrefix", async () => {
  const { index, calls } = fakeIndex();
  const app = appFor({
    index,
    storage: {
      existsOriginalPath: async () => false,
      folderExists: async (p: string) => p === "old",
      renameFolder: async () => {},
      invalidateAllCacheEntries: () => {},
    },
  });

  const res = await app.request("/storage/old", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "new" }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(calls, [{ op: "moveFolderPrefix", args: ["old", "new"] }]);
});

test("POST copy calls copyPath", async () => {
  const { index, calls } = fakeIndex();
  const app = appFor({
    index,
    storage: {
      existsOriginalPath: async (p: string) => p === "a.jpg",
      folderExists: async () => false,
      copyOriginal: async () => {},
    },
  });

  const res = await app.request("/storage/a.jpg/copy", { method: "POST" });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(calls[0].op, "copyPath");
  assert.equal(calls[0].args[0], "a.jpg");
  assert.equal(typeof calls[0].args[1], "string");
});

test("POST move folder calls moveFolderPrefix", async () => {
  const { index, calls } = fakeIndex();
  const app = appFor({
    index,
    storage: {
      existsOriginalPath: async () => false,
      folderExists: async (p: string) => p === "album",
      renameFolder: async () => {},
      invalidateAllCacheEntries: () => {},
    },
  });

  const res = await app.request("/storage/album/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination: "archive" }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(calls, [
    { op: "moveFolderPrefix", args: ["album", "archive/album"] },
  ]);
});

test("index throw after rename still returns 200", async () => {
  const app = appFor({
    index: {
      movePath: () => {
        throw new Error("index down");
      },
    },
    storage: {
      existsOriginalPath: async (p: string) => p === "a.jpg",
      folderExists: async () => false,
      renameOriginal: async () => {},
      invalidateAllCacheEntries: () => {},
    },
  });

  const res = await app.request("/storage/a.jpg", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "b.jpg" }),
  });
  assert.equal(res.status, 200, await res.clone().text());
});

test("POST /storage/reconcile returns 409 while a reconcile is in flight", async () => {
  let release: () => void = () => {};
  const hang = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalInFlight: () => void = () => {};
  const inFlight = new Promise<void>((resolve) => {
    signalInFlight = resolve;
  });
  const app = appFor({
    index: {},
    storage: {
      listAllParallel: async () => {
        signalInFlight();
        await hang;
        return [];
      },
    },
  });

  const first = app.request("/storage/reconcile", { method: "POST" });
  await inFlight;
  const second = await app.request("/storage/reconcile", { method: "POST" });
  assert.equal(second.status, 409);
  const json = await second.json();
  assert.equal(json.error, "reconcile_in_progress");
  release();
  const firstRes = await first;
  assert.equal(firstRes.status, 200);
  const firstJson = await firstRes.json();
  assert.equal(firstJson.ok, true);
  assert.equal(firstJson.mode, "s3-upsert");
});
