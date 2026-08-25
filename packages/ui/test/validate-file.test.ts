import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ACCEPT,
  DEFAULT_MAX_SIZE,
  filesFromDropzone,
  validateFile,
} from "../src/file-uploader/use-file-upload";

function fakeFile(name: string, type: string): File {
  return new File(["x"], name, { type });
}

test("DEFAULT_ACCEPT lists zip and html so the dashboard picker can attach them", () => {
  const exts = Object.values(DEFAULT_ACCEPT).flat();
  assert.ok(exts.includes(".zip"));
  assert.ok(exts.includes(".html"));
  assert.ok(DEFAULT_ACCEPT["application/zip"]?.includes(".zip"));
  assert.ok(DEFAULT_ACCEPT["text/html"]?.includes(".html"));
});

test("validateFile accepts zip and html even when the browser sends an empty MIME", () => {
  assert.equal(validateFile(fakeFile("vault.zip", ""), DEFAULT_ACCEPT, DEFAULT_MAX_SIZE), null);
  assert.equal(
    validateFile(fakeFile("index.html", "text/html"), DEFAULT_ACCEPT, DEFAULT_MAX_SIZE),
    null,
  );
  assert.equal(
    validateFile(fakeFile("vault.zip", "application/zip"), DEFAULT_ACCEPT, DEFAULT_MAX_SIZE),
    null,
  );
});

test("validateFile still rejects svg", () => {
  const error = validateFile(
    fakeFile("evil.svg", "image/svg+xml"),
    DEFAULT_ACCEPT,
    DEFAULT_MAX_SIZE,
  );
  assert.match(error ?? "", /not allowed/i);
});

test("filesFromDropzone recovers zip/html that dropzone rejected by MIME", () => {
  const zip = fakeFile("vault.zip", "application/x-compressed");
  const html = fakeFile("index.html", "");
  const exe = fakeFile("payload.exe", "application/x-msdownload");
  const { files, rejectedNames } = filesFromDropzone(
    [],
    [{ file: zip }, { file: html }, { file: exe }],
    DEFAULT_ACCEPT,
  );
  assert.deepEqual(
    files.map((file) => file.name).sort(),
    ["index.html", "vault.zip"],
  );
  assert.deepEqual(rejectedNames, ["payload.exe"]);
});

test("filesFromDropzone keeps already-accepted files", () => {
  const png = fakeFile("shot.png", "image/png");
  const { files, rejectedNames } = filesFromDropzone(
    [png],
    [],
    DEFAULT_ACCEPT,
  );
  assert.deepEqual(
    files.map((file) => file.name),
    ["shot.png"],
  );
  assert.deepEqual(rejectedNames, []);
});
