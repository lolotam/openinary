import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createRawRoute } from "./raw";
import { TransformService } from "../services/transform.service";

const deps = (): any => ({
  storage: { existsOriginal: async () => true, exists: async () => false },
  queue: { getJobByPath: () => undefined, addJob: async () => "job-1" },
});

test("/raw streams an original with nosniff", async () => {
  const app = new Hono();
  app.route("/raw", createRawRoute(deps()));
  const original = TransformService.prototype.transform;
  TransformService.prototype.transform = async () =>
    ({
      stream: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([0x50, 0x4b]));
          c.close();
        },
      }),
      contentType: "application/zip",
      headers: {
        "Content-Disposition": 'attachment; filename="vault.zip"',
        "Accept-Ranges": "bytes",
      },
    }) as any;
  try {
    const response = await app.request("/raw/docs/vault.zip");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(
      response.headers.get("content-disposition"),
      'attachment; filename="vault.zip"',
    );
  } finally {
    TransformService.prototype.transform = original;
  }
});

test("/raw asks the service for originals only", async () => {
  const app = new Hono();
  app.route("/raw", createRawRoute(deps()));
  const original = TransformService.prototype.transform;
  let seen: any;
  TransformService.prototype.transform = async (req) => {
    seen = req;
    return {
      stream: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([0xff, 0xd8]));
          c.close();
        },
      }),
      contentType: "image/jpeg",
      headers: {},
    } as any;
  };
  try {
    const response = await app.request("/raw/photos/hero.jpg");
    assert.equal(response.status, 200);
    assert.equal(seen.originalsOnly, true);
    assert.equal(seen.path, "/t/photos/hero.jpg");
  } finally {
    TransformService.prototype.transform = original;
  }
});

test("/raw with a transform segment is a 400", async () => {
  const app = new Hono();
  app.route("/raw", createRawRoute(deps()));
  let called = false;
  const original = TransformService.prototype.transform;
  TransformService.prototype.transform = async () => {
    called = true;
    return { buffer: Buffer.from("no"), contentType: "text/plain", headers: {} } as any;
  };
  try {
    const response = await app.request("/raw/w_500/docs/vault.zip");
    assert.equal(response.status, 400);
    assert.equal(called, false, "must not reach the transform service");
    assert.match(await response.text(), /\/raw\/docs\/vault\.zip/);
  } finally {
    TransformService.prototype.transform = original;
  }
});
