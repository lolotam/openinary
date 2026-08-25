import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const distDir = join(dir, "..", "dist");

test("every entry emits its type declarations", () => {
  // Regression guard: tsup builds the index/server configs concurrently
  // against the same dist/ dir. A `clean: true` on either config races the
  // other's writes and can silently delete one entry's .d.ts — caught this
  // exact failure once (server.d.ts missing) before moving `clean` out of
  // tsup.config.ts into a deterministic pre-build step.
  for (const entry of ["index", "server"]) {
    assert.ok(
      existsSync(join(distDir, `${entry}.d.ts`)),
      `dist/${entry}.d.ts is missing`,
    );
  }
});

test("client entry carries the use client boundary", () => {
  const contents = readFileSync(join(distDir, "index.js"), "utf8");
  // Must be followed by a newline — Next.js/Turbopack's directive scanner
  // ignores a same-line directive even though it's valid JS syntax.
  assert.match(contents, /^"use client";\n/);
});

test("server entry does not carry the use client boundary", () => {
  const contents = readFileSync(join(distDir, "server.js"), "utf8");
  assert.doesNotMatch(contents, /use client/);
});

test("react is not bundled into the client entry", () => {
  const contents = readFileSync(join(distDir, "index.js"), "utf8");
  // Matches both `from "react"` and `from "react/jsx-runtime"` — either is
  // proof react was left external rather than inlined by esbuild.
  assert.match(contents, /from ?["']react(\/jsx-runtime)?["']/);
});

test("built DEFAULT_ACCEPT includes zip and html", () => {
  // The dashboard imports @openinary/ui from dist. A stale bundle that still
  // only listed images/video made the dropzone silently drop zip/html after
  // the file dialog closed.
  const contents = readFileSync(join(distDir, "index.js"), "utf8");
  assert.match(contents, /"application\/zip"/);
  assert.match(contents, /"text\/html"/);
  assert.match(contents, /"\.zip"/);
  assert.match(contents, /"\.html"/);
});

test("dashboard dropzone opts out of the File System Access picker", () => {
  // react-dropzone only reads the <input accept> when useFsAccessApi is off.
  // Left on, Chrome opens window.showOpenFilePicker instead and builds the
  // Explorer filter itself — zip/html never showed up there even though the
  // accept map listed them, so the file dialog looked empty for those types.
  const contents = readFileSync(join(distDir, "index.js"), "utf8");
  assert.ok(
    contents.includes("useFsAccessApi: false"),
    "dist/index.js does not disable the File System Access picker",
  );
});
