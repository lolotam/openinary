import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UPLOAD_BATCH_SIZE,
  chunkFiles,
  parseUploadResponse,
  retryAfterMs,
  uploadFilesInBatches,
} from "../src/components/upload-batch";

function fakeFile(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

test("chunkFiles splits 127 files into 7 batches of 20 then 7", () => {
  const files = Array.from({ length: 127 }, (_, i) => i);
  const batches = chunkFiles(files, UPLOAD_BATCH_SIZE);
  assert.equal(batches.length, 7);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [20, 20, 20, 20, 20, 20, 7],
  );
});

test("retryAfterMs uses Retry-After seconds and clamps", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(
    retryAfterMs(new Response(null, { headers: { "Retry-After": "2" } }), now),
    2000,
  );
  assert.equal(
    retryAfterMs(new Response(null, { headers: { "Retry-After": "0" } }), now),
    1000,
  );
  assert.equal(
    retryAfterMs(new Response(null, { headers: { "Retry-After": "120" } }), now),
    60_000,
  );
  const httpDate = new Date(now + 5000).toUTCString();
  assert.equal(
    retryAfterMs(
      new Response(null, { headers: { "Retry-After": httpDate } }),
      now,
    ),
    5000,
  );
});

test("retryAfterMs handles X-RateLimit-Reset seconds, ms, past, and malformed", () => {
  const now = 1_700_000_000_000;
  assert.equal(
    retryAfterMs(
      new Response(null, {
        headers: { "X-RateLimit-Reset": String(Math.floor(now / 1000) + 3) },
      }),
      now,
    ),
    3000,
  );
  assert.equal(
    retryAfterMs(
      new Response(null, { headers: { "X-RateLimit-Reset": String(now + 4000) } }),
      now,
    ),
    4000,
  );
  assert.equal(
    retryAfterMs(
      new Response(null, { headers: { "X-RateLimit-Reset": "1" } }),
      now,
    ),
    1000,
  );
  assert.equal(
    retryAfterMs(
      new Response(null, { headers: { "X-RateLimit-Reset": "nope" } }),
      now,
    ),
    1000,
  );
  assert.equal(retryAfterMs(new Response(null), now), 1000);
});

test("parseUploadResponse rejects empty and HTML bodies", async () => {
  await assert.rejects(
    () => parseUploadResponse(new Response("")),
    /Empty upload response/,
  );
  await assert.rejects(
    () => parseUploadResponse(new Response("<html>nope</html>")),
    /Malformed upload response/,
  );
  const parsed = await parseUploadResponse(
    new Response(JSON.stringify({ success: true, files: [] })),
  );
  assert.equal(parsed.success, true);
});

test("uploadFilesInBatches sends 127 files as 7 sequential requests", async () => {
  const calls: number[] = [];
  const files = Array.from({ length: 127 }, (_, i) => fakeFile(`${i}.jpg`));
  const result = await uploadFilesInBatches({
    files,
    folder: "album",
    url: "http://api/upload",
    fetch: async (_url, init) => {
      const body = init?.body as FormData;
      const batch = body.getAll("files");
      calls.push(batch.length);
      assert.equal(body.get("folder"), "album");
      return new Response(
        JSON.stringify({
          success: true,
          files: batch.map((file) => ({
            filename: (file as File).name,
            path: `album/${(file as File).name}`,
            size: 1,
            url: `/t/album/${(file as File).name}`,
          })),
        }),
      );
    },
  });
  assert.deepEqual(calls, [20, 20, 20, 20, 20, 20, 7]);
  assert.equal(result.success, true);
  assert.equal(result.files?.length, 127);
});

test("429 then success retries the same batch", async () => {
  let hits = 0;
  const files = [fakeFile("a.jpg")];
  const sleeps: number[] = [];
  const result = await uploadFilesInBatches({
    files,
    url: "http://api/upload",
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetch: async () => {
      hits += 1;
      if (hits === 1) {
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
          files: [
            { filename: "a.jpg", path: "a.jpg", size: 1, url: "/t/a.jpg" },
          ],
        }),
      );
    },
  });
  assert.equal(hits, 2);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(result.files?.length, 1);
});

test("persistent 429 stops later batches and keeps earlier successes", async () => {
  const files = Array.from({ length: 41 }, (_, i) => fakeFile(`${i}.jpg`));
  let calls = 0;
  const result = await uploadFilesInBatches({
    files,
    url: "http://api/upload",
    sleep: async () => {},
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            success: true,
            files: Array.from({ length: 20 }, (_, i) => ({
              filename: `${i}.jpg`,
              path: `${i}.jpg`,
              size: 1,
              url: `/t/${i}.jpg`,
            })),
          }),
        );
      }
      return new Response("", { status: 429, headers: { "Retry-After": "1" } });
    },
  });
  assert.equal(calls, 4); // 1 success + 3 attempts on the second batch
  assert.equal(result.files?.length, 20);
  assert.equal(result.errors?.length, 20);
  assert.equal(result.success, true);
});

test("malformed body does not abort remaining non-429 batches", async () => {
  const files = Array.from({ length: 21 }, (_, i) => fakeFile(`${i}.jpg`));
  let calls = 0;
  const result = await uploadFilesInBatches({
    files,
    url: "http://api/upload",
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response("<html>proxy</html>");
      return new Response(
        JSON.stringify({
          success: true,
          files: [{ filename: "20.jpg", path: "20.jpg", size: 1, url: "/t/20.jpg" }],
        }),
      );
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.files?.length, 1);
  assert.equal(result.errors?.length, 20);
});

test("mixed files and errors in one batch are merged", async () => {
  const files = [fakeFile("ok.jpg"), fakeFile("bad.jpg")];
  const result = await uploadFilesInBatches({
    files,
    url: "http://api/upload",
    fetch: async () =>
      new Response(
        JSON.stringify({
          success: true,
          files: [
            { filename: "ok.jpg", path: "ok.jpg", size: 1, url: "/t/ok.jpg" },
          ],
          errors: [{ filename: "bad.jpg", error: "too big" }],
        }),
      ),
  });
  assert.equal(result.files?.length, 1);
  assert.equal(result.errors?.length, 1);
  assert.equal(result.success, true);
});
