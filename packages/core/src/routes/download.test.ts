import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createDownloadRoute } from "./download";

function appFor(buffer: Buffer) {
  const app = new Hono();
  app.route(
    "/download",
    createDownloadRoute({
      storage: {
        downloadOriginal: async () => buffer,
      },
      queue: {},
    } as any),
  );
  return app;
}

test("html download carries nosniff and sandbox CSP", async () => {
  const res = await appFor(Buffer.from("<!DOCTYPE html><p>x</p>")).request(
    "/download/pages/index.html",
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    res.headers.get("content-security-policy"),
    "sandbox; default-src 'none'",
  );
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
});

test("xml download carries nosniff and sandbox CSP", async () => {
  const res = await appFor(Buffer.from("<root/>")).request(
    "/download/data/feed.xml",
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/xml");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    res.headers.get("content-security-policy"),
    "sandbox; default-src 'none'",
  );
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
});
