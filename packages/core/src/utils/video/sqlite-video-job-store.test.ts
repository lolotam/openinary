import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { SqliteVideoJobStore } from "./sqlite-video-job-store";

test("getJobByFileAndParams returns the most recently created job", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE video_jobs (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      params_json TEXT NOT NULL,
      cache_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'error', 'cancelled')),
      priority INTEGER NOT NULL DEFAULT 2,
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
  `);
  const store = new SqliteVideoJobStore(db);
  const params = { width: "640" };
  const firstId = store.createJob("clip.mp4", params, "first-cache");
  db.prepare("UPDATE video_jobs SET status = 'error', created_at = 100 WHERE id = ?")
    .run(firstId);
  const secondId = store.createJob("clip.mp4", params, "second-cache");
  db.prepare("UPDATE video_jobs SET created_at = 200 WHERE id = ?")
    .run(secondId);

  assert.equal(store.getJobByFileAndParams("clip.mp4", params)?.id, secondId);
});
