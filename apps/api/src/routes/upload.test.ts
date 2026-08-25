import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { generateUploadSignature } from "@openinary/core";

process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32chars!!";
process.env.API_SECRET = "test-secret-for-uploads-16";
process.env.DB_PATH = path.join(
  mkdtempSync(path.join(os.tmpdir(), "openinary-upload-")),
  "auth.db",
);

const { createUploadRoute } = await import("./upload.ts");

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const zipBytes = Buffer.from("PK\x03\x04rest-of-zip", "latin1");
const htmlBytes = Buffer.from("<!DOCTYPE html><p>hi</p>");

function fakeDeps(uploaded: { path: string; buffer: Buffer; contentType: string }[]) {
  return {
    storage: {
      existsOriginalPath: async () => false,
      uploadOriginal: async (filePath: string, buffer: Buffer, contentType: string) => {
        uploaded.push({ path: filePath, buffer, contentType });
        return `/t/${filePath}`;
      },
    },
    queue: {
      addJob: async () => "job-1",
      getJobByPath: () => undefined,
    },
  } as any;
}

function signedForm(folder: string, files: File[]): FormData {
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = generateUploadSignature(
    folder,
    expires,
    process.env.API_SECRET!,
  );
  const form = new FormData();
  form.set("folder", folder);
  form.set("signature", signature);
  form.set("expires", String(expires));
  for (const file of files) form.append("files", file);
  return form;
}

test("POST /upload accepts zip and html in a custom folder", async () => {
  const uploaded: { path: string; buffer: Buffer; contentType: string }[] = [];
  const app = new Hono();
  app.route("/upload", createUploadRoute(fakeDeps(uploaded)));

  const form = signedForm("vaults/2026", [
    new File([zipBytes], "obsidian-vault.zip", { type: "application/zip" }),
    new File([htmlBytes], "index.html", { type: "text/html" }),
  ]);

  const res = await app.request("/upload", { method: "POST", body: form });
  assert.equal(res.status, 200, await res.clone().text());
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.files.length, 2);
  assert.equal(json.files[0].url, "/t/vaults/2026/obsidian-vault.zip");
  assert.equal(json.files[1].url, "/t/vaults/2026/index.html");
  assert.equal(uploaded[0].contentType, "application/zip");
  assert.deepEqual([...uploaded[0].buffer], [...zipBytes]);
  assert.equal(uploaded[1].contentType, "text/html");
});

test("POST /upload still accepts jpeg and rejects svg", async () => {
  const uploaded: { path: string; buffer: Buffer; contentType: string }[] = [];
  const app = new Hono();
  app.route("/upload", createUploadRoute(fakeDeps(uploaded)));

  const ok = await app.request("/upload", {
    method: "POST",
    body: signedForm("photos", [
      new File([jpegBytes], "hero.jpg", { type: "image/jpeg" }),
    ]),
  });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).files[0].url, "/t/photos/hero.jpg");

  const bad = await app.request("/upload", {
    method: "POST",
    body: signedForm("photos", [
      new File([Buffer.from("<svg></svg>")], "evil.svg", {
        type: "image/svg+xml",
      }),
    ]),
  });
  assert.equal(bad.status, 400);
  const json = await bad.json();
  assert.equal(json.success, false);
  assert.match(json.errors[0].error, /Invalid file type/);
});

test("POST /upload rejects hidden dotfiles", async () => {
  const uploaded: { path: string; buffer: Buffer; contentType: string }[] = [];
  const app = new Hono();
  app.route("/upload", createUploadRoute(fakeDeps(uploaded)));

  const res = await app.request("/upload", {
    method: "POST",
    body: signedForm("vaults", [
      new File([zipBytes], ".secret.zip", { type: "application/zip" }),
    ]),
  });
  assert.equal(res.status, 400);
  assert.equal(uploaded.length, 0);
  assert.match((await res.json()).errors[0].error, /Invalid file path/);
});

test("POST /upload indexes the final path after a successful save", async () => {
  const uploaded: { path: string; buffer: Buffer; contentType: string }[] = [];
  const indexed: unknown[] = [];
  const app = new Hono();
  app.route(
    "/upload",
    createUploadRoute({
      ...fakeDeps(uploaded),
      assetIndex: {
        upsertFromUpload: (input: unknown) => {
          indexed.push(input);
          return input;
        },
      },
    } as any),
  );

  const res = await app.request("/upload", {
    method: "POST",
    body: signedForm("photos", [
      new File([jpegBytes], "hero.jpg", { type: "image/jpeg" }),
    ]),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(indexed.length, 1);
  const row = indexed[0] as { path: string; filename: string; mediaType: string };
  assert.equal(row.path, "photos/hero.jpg");
  assert.equal(row.filename, "hero.jpg");
  assert.equal(row.mediaType, "image");
});

test("POST /upload still returns 200 when indexing throws", async () => {
  const uploaded: { path: string; buffer: Buffer; contentType: string }[] = [];
  const app = new Hono();
  app.route(
    "/upload",
    createUploadRoute({
      ...fakeDeps(uploaded),
      assetIndex: {
        upsertFromUpload: () => {
          throw new Error("index down");
        },
      },
    } as any),
  );

  const res = await app.request("/upload", {
    method: "POST",
    body: signedForm("photos", [
      new File([jpegBytes], "hero.jpg", { type: "image/jpeg" }),
    ]),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.files[0].path, "photos/hero.jpg");
});

test("POST /upload accepts a zip with an empty browser MIME", async () => {
  const uploaded: { path: string; buffer: Buffer; contentType: string }[] = [];
  const app = new Hono();
  app.route("/upload", createUploadRoute(fakeDeps(uploaded)));

  const res = await app.request("/upload", {
    method: "POST",
    body: signedForm("vaults", [
      new File([zipBytes], "obsidian-vault.zip", { type: "" }),
    ]),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(uploaded[0].path, "vaults/obsidian-vault.zip");
});
