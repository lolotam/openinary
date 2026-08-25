# Asset Index, Folder Covers, and Bulk-Upload Hang Fix

> **For agentic workers:** Implement task-by-task after this plan is approved. Do not start implementation until Codex signs off. Do not commit — the orchestrator commits.

**Goal:** Self-hosted Openinary can search assets instantly, show a chosen folder cover, and upload folders of hundreds of files without hanging; the work lands on `main` only after review and merge.

**Architecture:** Keep live folder listing (`readdirSync` / S3 `listAllParallel`) as the source of truth for the grid. Add an additive SQLite asset index with FTS5 for search, lifecycle hooks on **upload, delete, rename, copy, and move**, and a safe reconcile walker that never mass-deletes from a single S3 list. Store folder covers in a sibling SQLite table keyed by folder path. Batch dashboard uploads client-side so one multipart request cannot starve the browser or trip the public rate limiter.

**Tech Stack:** Hono + `@openinary/core`, better-sqlite3 (existing `auth.db`), SQLite FTS5, React 19 + TanStack Query in `@openinary/ui` and `apps/web`. Tests: Node `node:test` + `tsx`. UI tests live under `packages/ui/test/` (the package's existing discovery root).

---

## Codex round 1 (REJECT) — revisions locked in this draft

Codex session `01a038e0-c44c-7cd3-b16b-1f186e9fb873` rejected the first draft. Every blocking objection is addressed below. Do not revert them.

| # | Objection | Plan change |
| --- | --- | --- |
| 1 | Index only upload/delete; rename/copy/move leave stale rows | Hook `PATCH /storage/*`, `POST /storage/*/copy`, `POST /storage/*/move` |
| 2 | `listAllParallel` has no completeness proof; one S3 list must not mass-delete | S3 reconcile is **upsert-only**. Hard deletes only from mutation hooks, or from a **local** walk that finished without error |
| 3 | Startup `readdirSync` still blocks the event loop | Async chunked `fs.promises.readdir`; yield between batches. Add `mtime` column |
| 4 | Cover path rules contradict root covers; Windows `\` / UNC / drive | Canonical posix path helper; root = `folder === ""` and cover is a file with no `/`; never `path === folder` |
| 5 | S3 folder delete returns before unindex | `removeByPath` / `removeByFolderPrefix` own cover cleanup; called on **every** successful `deleteAssetCompletely` return, including the S3-folder early return |
| 6 | Cloud `MediaGrid` would call missing `/folders/thumbnail` | Optional `onSetFolderCover` / `folderCoverEnabled` prop; self-hosted dashboard turns it on; Cloud stays off |
| 7 | `useFolderSummaries` never invalidates; `VideoThumbnail` retries ~1 min | Covers on `GET /storage` folders; invalidate summaries via query cache; cover tiles use a plain `<img>` with immediate `onError` fallback (not `VideoThumbnail`) |
| 8 | `_` in folder names is a LIKE wildcard; cursor/`degraded` unspecified | Escape LIKE; cursor = `updated_at:id`; `search()` returns `{ results, nextCursor, degraded }` |
| 9 | Dual bootstrap ("optionally also shared") | **One** path: `apps/api/src/config/asset-index.ts` calls `ensureAssetIndexSchema(db)` before `RouteDeps`. Never `init-db.ts`. Never `shared/auth.ts` |
| 10 | Unix `find` on Windows; UI tests only discover `test/` | Switch those package `test` scripts to `node --import tsx --test <glob>`. Put UI tests in `packages/ui/test/`. Blocking test is a **mocked 127-file orchestrator**, not a Playwright run (this package has no browser runner) |
| 11 | Unbounded 429 wait; "3 retries" vs 3 attempts | **3 total attempts**. Wait clamped to **1–60s**. Malformed/past reset → 1s. Persistent 429 after 3 attempts stops remaining batches |

---

## Phase 0 context (locked)

- **Repo:** `lolotam/openinary` fork. Branch to land on: `main`. Feature branch: `feature/asset-index-and-folder-thumbnails`.
- **No `AGENTS.md`.** Deploy path is Docker / compose (`Dockerfile`, `docker-compose.yml`). Merging to `main` may trigger a Dokploy deploy if that is wired — treat merge as production.
- **SSH MCP:** `ssh-contabo-mcp` is available; schema is local SQLite, not a remote Postgres migration.
- **Scope in:** self-hosted `apps/api`, `apps/web`, `packages/core`, `packages/ui`, `packages/shared` (db bootstrap only if required).
- **Scope out:** `apps/cloud/**` (Postgres + Drizzle), marketing, docs site except a short changelog note if the repo convention requires it. Do not introduce Drizzle into self-hosted.
- **Do not break:** `/t/*` and `/raw/*` streaming, including HTTP 416 range handling in `packages/core/src/utils/http-range.ts`.

---

## Design decisions (must not silently reverse)

### D1. No Drizzle on self-hosted

The request mentioned "SQLite/Drizzle/better-sqlite3". This tree already uses **better-sqlite3 with raw SQL**. Drizzle exists only in `apps/cloud/server` against Postgres. Introducing Drizzle for one table is scope creep and a second ORM. **Use better-sqlite3**, matching `SqliteVideoJobStore`.

### D2. One bootstrap path, matching the video queue

`apps/api/src/utils/init-db.ts` is dead code. Auth tables live in `packages/shared/src/auth.ts` → `initializeTables()`. Video jobs are `new SqliteVideoJobStore(db)` from `apps/api/src/config/queue.ts`.

**Exact startup path (the only one):**

1. `packages/shared` opens `db` and creates auth/video_jobs tables (unchanged).
2. `apps/api/src/config/asset-index.ts` imports `db` from `shared`, calls `ensureAssetIndexSchema(db)` inside a `db.transaction()`, then `export const assetIndex = new SqliteAssetIndex(db)`.
3. **Two-step schema, not one transaction that includes FTS:**
   - Transaction A: `CREATE TABLE assets` + indexes + `folder_covers`. Commit. Mutations work even if FTS fails.
   - Then attempt FTS virtual table + triggers. On `no such module: fts5` (or any FTS error): log, `ftsAvailable = false`, do **not** roll back A.
   - Whenever FTS is first created **or** dropped and recreated, run `INSERT INTO assets_fts(assets_fts) VALUES('rebuild')` so rows inserted while FTS was missing (or that survived a drop) are indexed. Triggers only cover subsequent mutations.
4. `apps/api/src/index.ts` builds `RouteDeps` **after** that module is imported so schema exists before the first request.
5. **Do not** call `ensureAssetIndexSchema` from `shared/auth.ts`. **Do not** edit `init-db.ts`.

Postcondition tests: tables exist; insert then FTS match; insert **before** FTS create, then create+rebuild, then match; recreate-triggers path also rebuilds.

### D3. Search is additive; listing stays live

`GET /storage?path=` (local `readdirSync`, S3 delimiter list) remains the dashboard grid. The `assets` table is for search + metadata + covers. If the index is empty or FTS5 is unavailable, search returns `{ results: [], degraded: true }` and the grid still works.

### D4. API surface (auth-protected, same as `/storage`)

Existing delete is **`DELETE /storage/*`**, not `DELETE /assets/*`. Index removal hooks `deleteAssetCompletely` so every delete path unindexes.

User-requested routes, mounted with `apiKeyAuth` like `/storage`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/assets/search?q=&type=&folder=&limit=&cursor=` | FTS5 search |
| `POST` | `/storage/reconcile` | On-demand backfill |
| `POST` | `/folders/thumbnail` | Set folder cover `{ folder, path }` |
| `DELETE` | `/folders/thumbnail` | Reset cover `{ folder }` |

Also include `coverPath` on existing folder listing (`GET /storage`, `GET /storage/folder-summaries`) so the grid does not need a second round-trip.

Search is **not** public. It sits behind `apiKeyAuth` (session cookie from the dashboard already works for `/storage`).

### D5. Folder covers live in SQLite, not in the filesystem

Folders are prefixes, not rows. A `folder_covers` table keyed by normalized folder path stores the chosen image path. The cover **must** be an image asset whose path is inside that folder (prefix + `/`). If the cover file is later deleted, the row is deleted in the same transaction as the asset unindex (or left stale and the UI falls back when `/t/` 404s — prefer delete-the-row).

### D6. FTS5 queries are never raw user MATCH strings

Sanitize to alphanumeric tokens plus prefix `*` terms. Reject empty after sanitize with `400`. Never interpolate `q` into SQL.

### D7. Bulk upload: sequential batches of 20 (upstream PR #138)

`packages/ui/src/components/upload-section.tsx` currently appends **every** file into one `FormData` and `POST /upload` once. That hangs around ~127 files.

Apply the upstream pattern:

- Chunk files into sequential batches of **20**.
- Preserve `webkitRelativePath` / nested folders (the API already concatenates `folder + webkitRelativePath`).
- Aggregate `files` / `errors` across batches.
- On HTTP 429, retry up to **3** times honoring `Retry-After` or `X-RateLimit-Reset`.
- Treat empty / non-JSON bodies as a batch failure, not a throw that aborts remaining batches.
- Public rate limit is `PUBLIC_RATE_LIMIT_MAX` default **100 / 60s** on `POST /upload` (`apps/api/src/middleware/rate-limit.ts`). Sequential batches of 20 keep 853 files at ~43 requests — under the default window. Retry is still required.

Do **not** change `packages/ui/src/file-uploader/use-file-upload.ts` in this work (already per-file XHR). Out of scope unless a later review proves the dashboard dialog uses it.

### D8. Cloud app is out of scope

`packages/ui` changes (media-grid context menu, folder tile) will flow to Cloud automatically. Do not add SQLite FTS to Cloudflare/D1 in this PR.

---

## Current-state map (files the implementer must read first)

| Area | Path | Notes |
| --- | --- | --- |
| DB bootstrap (live) | `packages/shared/src/auth.ts` | `initializeTables()`, exports `db` |
| DB bootstrap (dead) | `apps/api/src/utils/init-db.ts` | unused — do not treat as source of truth |
| Queue wiring | `apps/api/src/config/queue.ts` | pattern to copy for AssetIndex |
| Upload | `apps/api/src/routes/upload.ts` | after successful save, index the asset |
| Upload tests | `apps/api/src/routes/upload.test.ts` | fake deps + signed FormData |
| Delete | `packages/core/src/utils/asset-deletion.ts` | hook unindex here |
| Storage listing | `packages/core/src/routes/storage.ts` | add `coverPath` to folder JSON |
| Path safety | `packages/core/src/utils/storage-level.ts` | `normalizeLevelPath` |
| Media type | `packages/core/src/utils/storage-level.ts` | `getMediaType` |
| S3 listing | `packages/core/src/utils/storage/` | `listAllParallel`, listing-cache |
| App mount | `apps/api/src/index.ts` | add `/assets` and `/folders` behind `apiKeyAuth` |
| Upload UI hang | `packages/ui/src/components/upload-section.tsx` | one FormData for all files |
| Folder tiles + menus | `packages/ui/src/media-grid.tsx` | mosaic previews, context menus |
| Folder summaries | `packages/ui/src/hooks/use-folder-summaries.ts` | |
| Header | `apps/web/src/components/headerbar.tsx` | search bar lives here |
| Dashboard | `apps/web/src/app/(dashboard)/page.tsx` | `?folder=` query |
| Types | `packages/ui/src/types.ts` | `StorageFolder` needs optional `coverPath` |
| Range 416 | `packages/core/src/utils/http-range.ts` | do not touch |

---

## Schema

SQLite on the existing `auth.db` (path `DB_PATH` or `data/auth.db`).

```sql
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,                 -- uuid
  path TEXT NOT NULL UNIQUE,           -- posix relative, no leading slash
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image','video','raw')),
  folder TEXT NOT NULL,                -- '' for root; posix parent of path
  content_hash TEXT,                   -- sha256 hex of bytes at index time; nullable on reconcile if skipped
  thumbnail_path TEXT,                 -- nullable; unused in v1 UI (grid still uses /t/)
  custom_metadata TEXT NOT NULL DEFAULT '{}', -- JSON object as text
  mtime INTEGER,                       -- source last-modified ms; from fs.stat / S3 LastModified
  created_at INTEGER NOT NULL,         -- index-row created
  updated_at INTEGER NOT NULL          -- index-row last upsert
);

CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder);
CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type);
CREATE INDEX IF NOT EXISTS idx_assets_updated_at ON assets(updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
  filename,
  path,
  custom_metadata,
  content='assets',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS assets_ai AFTER INSERT ON assets BEGIN
  INSERT INTO assets_fts(rowid, filename, path, custom_metadata)
  VALUES (new.rowid, new.filename, new.path, new.custom_metadata);
END;

CREATE TRIGGER IF NOT EXISTS assets_ad AFTER DELETE ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, filename, path, custom_metadata)
  VALUES ('delete', old.rowid, old.filename, old.path, old.custom_metadata);
END;

CREATE TRIGGER IF NOT EXISTS assets_au AFTER UPDATE ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, filename, path, custom_metadata)
  VALUES ('delete', old.rowid, old.filename, old.path, old.custom_metadata);
  INSERT INTO assets_fts(rowid, filename, path, custom_metadata)
  VALUES (new.rowid, new.filename, new.path, new.custom_metadata);
END;

CREATE TABLE IF NOT EXISTS folder_covers (
  folder TEXT PRIMARY KEY,             -- normalizeLevelPath result; '' is root
  cover_path TEXT NOT NULL,            -- assets.path of an image inside folder
  updated_at INTEGER NOT NULL
);
```

Idempotent: `CREATE IF NOT EXISTS` inside one transaction. No migration framework. After create, if `assets_fts` exists but triggers are missing, `DROP` the FTS table and recreate with triggers.

`folder` is a path string, not a `folder_id` UUID, because folders are not first-class rows.

`mtime` is the **source** timestamp (fs.stat.mtimeMs or S3 `LastModified`). `updated_at` is when the index row last changed. Reconcile compares `(path, size, mtime)` against stored `(size, mtime)`, never against `updated_at`.

---

## Module layout

Create:

- `packages/core/src/utils/asset-index/schema.ts` — `ensureAssetIndexSchema(db: Database)`
- `packages/core/src/utils/asset-index/store.ts` — `SqliteAssetIndex`
- `packages/core/src/utils/asset-index/fts-query.ts` — sanitize + build MATCH
- `packages/core/src/utils/asset-index/reconcile.ts` — walker
- `packages/core/src/utils/asset-index/types.ts`
- `packages/core/src/utils/asset-index/index.ts`
- tests next to each: `fts-query.test.ts`, `store.test.ts`, `reconcile.test.ts`
- `packages/core/src/routes/assets-search.ts` — `createAssetsSearchRoute(deps)`
- `packages/core/src/routes/folder-thumbnail.ts` — `createFolderThumbnailRoute(deps)`
- `apps/api/src/config/asset-index.ts` — construct store from `db`
- `packages/ui/src/hooks/use-asset-search.ts`
- `packages/ui/src/components/asset-search.tsx`
- `packages/ui/src/components/upload-batch.ts` — batching + 429 retry helpers
- `packages/ui/test/upload-batch.test.ts` — 127-file orchestrator + 429 cases

Extend `RouteDeps` in `packages/core/src/config/deps.ts`:

```ts
assetIndex?: AssetIndex | null;
```

Optional so Cloud worker can keep compiling without SQLite. Self-hosted always passes the store.

---

## SqliteAssetIndex API

```ts
interface AssetRecord {
  id: string;
  path: string;
  filename: string;
  size: number;
  mime: string;
  mediaType: "image" | "video" | "raw";
  folder: string;
  contentHash: string | null;
  thumbnailPath: string | null;
  customMetadata: Record<string, unknown>;
  mtime: number | null; // source last-modified ms
  createdAt: number;
  updatedAt: number;
}

interface SearchParams {
  q: string;
  type?: "image" | "video" | "raw";
  folder?: string; // prefix match, normalized
  limit?: number;  // default 25, max 100
  cursor?: string; // opaque updated_at+id
}

interface AssetIndex {
  ftsAvailable: boolean;
  upsertFromUpload(input: Omit<AssetRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): AssetRecord;
  /**
   * File rename/move. Rewrites assets.path/folder/filename.
   * Same-folder rename: also rewrite folder_covers.cover_path that equal `from`.
   * Cross-folder move: DELETE folder_covers WHERE cover_path = from
   * (the image is no longer inside the folder that selected it).
   */
  movePath(from: string, to: string): void;
  /** File copy. Inserts a new row cloned from `from` with path `to`. Covers are not copied. */
  copyPath(from: string, to: string): void;
  /** Folder rename/move. Rewrites every assets.path/folder and folder_covers.folder/cover_path with that prefix. */
  moveFolderPrefix(from: string, to: string): void;
  /** File delete. Also DELETE FROM folder_covers WHERE cover_path = path. */
  removeByPath(path: string): void;
  /** Folder delete. Removes assets under prefix and covers whose folder or cover_path is under the prefix. */
  removeByFolderPrefix(folder: string): void;
  search(params: SearchParams): { results: AssetRecord[]; nextCursor: string | null; degraded: boolean };
  getCover(folder: string): string | null;
  setCover(folder: string, coverPath: string): void;
  clearCover(folder: string): void;
  coversFor(folders: string[]): Map<string, string>;
  getByPath(path: string): AssetRecord | null;
  /** Local reconcile only. Paginated. Do not load the whole table for S3. */
  iterPaths(batchSize: number): Iterable<string>;
}
```

All mutation methods that touch covers + assets run inside `db.transaction()`.

`upsertFromUpload` is keyed by `path` UNIQUE. Same path after overwrite updates size/hash/mtime.

---

## FTS5 query sanitizer

File: `packages/core/src/utils/asset-index/fts-query.ts`

Rules:

1. Trim; if empty → caller returns 400 `"q is required"`.
2. Strip characters other than letters, numbers, and whitespace (unicode letters allowed via `\p{L}\p{N}`).
3. Split on whitespace; drop tokens shorter than 1 char.
4. Cap at 8 tokens.
5. Each token → `'"' + token.replace(/"/g, '') + '"*'` (prefix).
6. Join with AND (`token1 AND token2`).
7. If sanitizer yields no tokens → 400.
8. SQL: `WHERE assets_fts MATCH ?` with the bound string. JOIN `assets` on `rowid`.
9. Type filter: `assets.media_type = ?` when `type` is one of `image|video|raw`; otherwise 400.
10. Folder prefix: `assets.folder = ? OR assets.folder LIKE ? ESCAPE '\'` where the LIKE pattern is `escapeLike(folder) || '/%'`. `escapeLike` replaces `\`, `%`, and `_` with `\\`, `\%`, `\_`.
11. Order: `ORDER BY assets.updated_at DESC, assets.id DESC` (stable).
12. Cursor: opaque `base64url(updated_at + "\n" + id)`. Invalid cursor → 400. Bound as `(updated_at < ?) OR (updated_at = ? AND id < ?)`.
13. `limit` default 25, max 100, non-integer → 400.

Malformed MATCH must be caught: wrap `search` in try/catch, log, return `{ results: [], nextCursor: null, degraded: true }` with **200** so the header search never hard-fails the dashboard. If `ftsAvailable` is false, same shape without hitting SQLite FTS.

Path traversal: `folder` query param goes through `canonicalizeStoragePath` (below). `null` → 400.

---

## Lifecycle hooks

### Upload (`POST /upload`)

After a file is successfully written (local `saveFileLocally` or `storage.uploadOriginal`) and pushed to `successfulUploads`, call:

```
assetIndex.upsertFromUpload({
  path: finalPath,
  filename: basename(finalPath),
  size: buffer.byteLength,
  mime: normalizedContentType,
  mediaType: getMediaType(finalPath) ?? "raw",
  folder: parentFolder(finalPath),
  contentHash: sha256(normalizedBuffer),
  thumbnailPath: null,
  customMetadata: {},
  mtime: Date.now(), // local: Date.now() after write (or fs.stat mtimeMs); S3: Date.now() (S3 LastModified is not returned by uploadOriginal today)
})
```

Wrap in try/catch: **upload must still succeed if indexing fails**. Log the error.

Do the same for `POST /upload/createfolder`? Folders have no asset row. No-op.

### Delete (`DELETE /storage/*` → `deleteAssetCompletely`)

Pass `assetIndex` as an optional 4th argument (or options bag). Existing callers without it still compile.

`packages/core/src/utils/asset-deletion.ts` currently **returns immediately** after S3 `deleteFolder` (lines 41–52). Unindex **before that return**, and on every other successful path, including local folder recursion.

- File: `removeByPath(filePath)` (covers pointing at that path go away inside the method).
- Folder: `removeByFolderPrefix(filePath)` (covers under the prefix go away inside the method).
- Recursion: thread the same `assetIndex` into nested `deleteAssetCompletely` calls.
- Index failure after a successful storage delete: log; do not fail the HTTP delete (object is already gone). Reconcile (local) will catch the stale row.

### Rename (`PATCH /storage/*`)

After the filesystem/S3 rename succeeds (`storage.ts` ~740):

- File: `assetIndex.movePath(filePath, newPath)`
- Folder: `assetIndex.moveFolderPrefix(filePath, newPath)`

### Copy (`POST /storage/*/copy`)

After copy succeeds: `assetIndex.copyPath(filePath, newPath)` (files only; folders are not copied today).

### Move (`POST /storage/*/move`)

- File: `assetIndex.movePath(filePath, newPath)`
- Folder: `assetIndex.moveFolderPrefix(filePath, newPath)`

Index errors after a successful storage mutation: log; HTTP still 200. Local reconcile heals.

### Reconcile

`reconcileAssetIndex({ storage, localRoot: "./public", index })`

**Local (may delete):**

1. Walk with `fs.promises.readdir(..., { withFileTypes: true })`, **not** `readdirSync`. Process at most 50 entries then `await setImmediate` (or `setTimeout(0)`) so `/health` and `/t` stay responsive.
2. Skip dotfiles. `stat` for `size` + `mtimeMs`.
3. Upsert if missing or `(size, mtime)` changed. Compare against stored `size`/`mtime`, never `updated_at`.
4. After the walk finishes **without error**, iterate `index.iterPaths(500)` and `removeByPath` for paths not seen. Also drop covers whose `cover_path` is missing.
5. If the walk throws mid-way: abort, **no deletes**.

**S3 (upsert-only — never hard-delete from a listing):**

`listAllParallel` / `listObjects` return a bare array with **no completeness or freshness proof**. A successful but eventually-consistent list can omit live objects.

- Upsert listed objects the same as local.
- **Do not** delete index rows that are missing from the listing.
- Deletes happen only via `deleteAssetCompletely` / rename / move hooks.
- If listing throws: abort, no writes that assume completeness (upserts already applied may stay; that is fine).

**Startup:** after `serve()` (listen is already before background work in `server.ts`). Kick off the async walker. Never call sync recursive I/O.

**On-demand:** `POST /storage/reconcile` (apiKeyAuth). Returns `{ ok: true, upserted, removed, durationMs, mode: "local" | "s3-upsert" }`. Concurrent calls: single-flight mutex; second caller gets `409 { error: "reconcile_in_progress" }`.

Content hash is written on upload. Reconcile does not download S3 bodies to hash.

---

## Path canonicalization (covers, search folder, reconcile keys)

New helper `canonicalizeStoragePath(raw: string): string | null` in `packages/core/src/utils/storage-level.ts` (extend tests in `storage-level.test.ts`):

1. Replace `\` with `/`.
2. Reject if it matches `^[A-Za-z]:` (Windows drive) or starts with `//` or `\\\\` (UNC) or is absolute (`/` after step 1 still leading).
3. Then `normalizeLevelPath` (rejects `..`, `.`, empty segments).
4. Result is posix relative or `""` for root.

**Cover containment (never `path === folder`):**

- Cover `path` must canonicalize to a **file** path (`getMediaType(path) === "image"`). A directory named `foo.jpg` is rejected by existence check (`stat` is file, not dir).
- If `folder === ""` (root): cover path must contain **no** `/` (the file lives in the bucket/root). This is how root covers work.
- If `folder !== ""`: cover path must start with `folder + "/"` (strict prefix, so `cats` does not match `cats2/x.jpg`).
- Reject sibling-prefix tricks: `folder=cats`, `path=cats2/x.jpg`.

Local existence: resolve under `./public` with `path.resolve` and verify `resolved === path.resolve("./public", canonical)` (containment after resolve). S3: `existsOriginal(canonical)` only — keys are already posix.

Tests: `..`, `C:\`, `\\server\share`, root cover `folder="" path="hero.jpg"`, nested `folder="a/b" path="a/b/c.jpg"`, sibling prefix, directory-as-image.

## Folder thumbnail API

`POST /folders/thumbnail` JSON `{ folder: string, path: string }`

1. `folder = canonicalizeStoragePath(folder)` (allow `""`). `path = canonicalizeStoragePath(path)` — reject null / empty path.
2. Apply cover containment rules above.
3. `getMediaType(path) === "image"` else 400.
4. Verify the object exists **as a file** (local `statSync.isFile()` or `storage.existsOriginal`). 404 if missing.
5. `setCover(folder, path)`.
6. Return `{ ok: true, folder, coverPath: path }`.

`DELETE /folders/thumbnail` JSON or query `folder=`

1. Canonicalize folder.
2. `clearCover(folder)`.
3. Return `{ ok: true, folder, coverPath: null }`.

Listing: when shaping `LevelFolder` in `GET /storage`, attach `coverPath: covers.get(folder.path) ?? null`. That is the grid's source of truth for covers. `GET /storage/folder-summaries` may also include `coverPath` but the tile must not depend on the summary cache for it.

Server-side `invalidateListingCache()` is **not** what refreshes SQLite cover data; the next `GET /storage` reads `folder_covers` live. Client must still `invalidateStorage()`.

---

## UI

### Search bar (`apps/web` header)

Add `AssetSearch` from `@openinary/ui` into `headerbar.tsx`, between breadcrumb and the right-side controls. Behavior:

- Wrap the control in an element with `role="search"`. The input itself gets `aria-label="Search assets"`, `role="combobox"`, `aria-expanded`, `aria-controls` pointing at a `role="listbox"` of results. Arrow keys move `aria-activedescendant`; Enter navigates.
- Debounce 200ms.
- Type filter chips: All / Image / Video / Raw.
- Results in a popover (existing `popover.tsx`): filename, folder, type icon. Click → `onNavigate({ folder, asset })` from the dashboard page so both `folder` and `asset` query params update.
- Empty query: hide popover.
- Error / degraded: "Search index unavailable" — grid still usable.
- Scope: if the user is inside a folder, default `folder=` to current folder, with a control to search everywhere.

### Folder cover in `media-grid.tsx` (capability-gated)

Cloud's `apps/cloud/web/src/components/assets-view.tsx` already mounts `MediaGrid` and has **no** `/folders/thumbnail`. Default the new UI **off**.

New optional props on `MediaGrid`:

```ts
folderCoverEnabled?: boolean; // default false
onSetFolderCover?: (args: { folder: string; path: string }) => Promise<void>
onClearFolderCover?: (args: { folder: string }) => Promise<void>
```

Self-hosted `apps/web/src/app/(dashboard)/page.tsx` passes `folderCoverEnabled` and the POST/DELETE fetchers.

When enabled:

- On **image** file context menus, add `"Set as Folder Cover"`. POST via the callback. Toast. `invalidateStorage(queryClient)`.
- Folder tile: if `folder.coverPath` is set, render a **plain `<img>`** (not `VideoThumbnail` — that retries 404s for ~1 minute). `src` from `getFolderThumbnailUrl`. Immediate `onError` → mosaic / folder icon.
- Folder context menu `"Reset Folder Cover"` when `coverPath` is set.

`useFolderSummaries` currently caches forever outside React Query, so `invalidateStorage` cannot refresh mosaics. **Do not use it for covers.** Covers come from `GET /storage` `folders[].coverPath`. Still add `invalidateFolderSummaries` (query-key based, or reset the hook's `knownRef`) so a deleted preview image in the mosaic is not sticky after navigation back. Move summaries onto TanStack Query with key `["openinary", "folder-summaries", path]` if the change stays small; otherwise export `invalidateFolderSummaries(queryClient)` that the hook honors.

### Bulk upload (`upload-section.tsx`)

Extract helpers to `packages/ui/src/components/upload-batch.ts` and test them in `packages/ui/test/upload-batch.test.ts` (the package only discovers `test/*.test.ts`).

```ts
export const UPLOAD_BATCH_SIZE = 20;
export const UPLOAD_MAX_ATTEMPTS = 3; // 1 try + 2 retries
export function chunkFiles<T>(files: T[], size: number): T[][]
export function retryAfterMs(res: Response, now = Date.now()): number
export async function parseUploadResponse(res: Response): Promise<UploadResponse>
export async function uploadFilesInBatches(opts: { files: File[]; folder?: string; fetch: typeof fetch; url: string }): Promise<UploadResponse>
```

`retryAfterMs`:

- Prefer `Retry-After` delta-seconds; if HTTP-date, use `Date.parse`.
- Else `X-RateLimit-Reset` as unix seconds; if the value is > 1e12 treat as ms.
- If missing, malformed, NaN, or in the past → **1000ms**.
- Clamp to **[1000, 60000]**.

`uploadFilesInBatches`:

1. Chunk files into 20.
2. For each chunk: FormData with `folder` + the chunk's `File` objects (`webkitRelativePath` preserved).
3. `fetch POST`. On 429: wait `retryAfterMs`, retry until `UPLOAD_MAX_ATTEMPTS` total attempts for that chunk. On persistent 429: record batch-level errors using each file's relative path, **stop remaining batches**, keep already-succeeded files.
4. Empty / non-JSON / HTML body → batch failure (`parseUploadResponse` throws a typed error); do not abort remaining batches unless it was 429-exhausted.
5. Merge `files`/`errors`. Partial success is OK (`success: true` if any file uploaded, include errors array).
6. Caller invalidates storage **once** at the end, including after a stop.

Do not send one file per request.

Blocking test (mocked `fetch`, no browser): **127 files** → 7 batches of 20/20/20/20/20/20/7; all succeed; `fetch` called 7 times. Additional cases: 429 then success; persistent 429 stops later batches; malformed body; `207` with mixed files/errors; one invalidation at the end (assert a callback). This is the merge gate for issue #135, not a Playwright run. The repo's UI package has no browser test runner.

---

## Security

- All new routes: `apiKeyAuth` (same as `/storage`).
- Paths: `canonicalizeStoragePath` only; reject `..`, empty segments, Windows drive letters, UNC, backslashes.
- FTS MATCH bound parameter only.
- Cover path must be inside folder.
- Do not return absolute filesystem paths.
- `custom_metadata` JSON.parse in a try; on failure treat as `{}`. Never eval.
- Rate limit: `/assets/search` should use `apiKeyAuth` (better-auth key limiter) not the public IP limiter. Dashboard session cookies already authenticate `/storage`.

---

## Edge cases the implementation must handle

| Case | Behavior |
| --- | --- |
| S3 list incomplete / throws | Reconcile aborts; no mass deletes |
| Cover image deleted | Cover row removed in delete hook; UI falls back |
| Cover 404 at render | `onError` → mosaic / folder icon |
| FTS MATCH syntax error | Catch, return empty + `degraded` |
| Empty `q` | 400 |
| `folder=../etc` | 400 |
| Unicode filenames | FTS unicode61 tokenizer; path stored as UTF-8 |
| Root folder cover | `folder: ""` allowed |
| Concurrent reconcile | 409 single-flight |
| Index write fails on upload | Upload 200 still |
| HEIC converted to JPG | Index the **final** path (`normalizeUploadFormat`) |
| Dotfiles | Never indexed (upload already rejects) |
| `/t` and `/raw` 416 | Untouched; add a regression test that `http-range.test.ts` still passes |
| Windows test `find` in package.json | New tests collocated `*.test.ts`; run via existing script. If Windows cannot run `find`, use `node --import tsx --test src/**/*.test.ts` only if the existing script is being edited anyway — do not drive-by rewrite all package.json test scripts |
| `media-grid` is large | Add cover menu + tile branch with minimal churn; no drive-by refactor of virtualizer |

---

## Test plan

Framework: `node:test` + `assert/strict` + `tsx`. In-memory better-sqlite3 (`Database(":memory:")`).

**Windows discovery (blocking for this PR, Node 20 — Docker and engines are Node 20, which does not expand test globs):**

Add a tiny enumerator `scripts/run-node-tests.mjs` in each of `packages/core`, `apps/api`, `packages/ui` (or one shared copy). It recursively collects `*.test.ts` under a root (`src` or `test`) using `fs.readdirSync` only, then `spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" })`.

Point all three `"test"` scripts at that wrapper. UI tests remain under `packages/ui/test/`. Do **not** use quoted globs, `find`, or `$()`.

### Unit

- `fts-query.test.ts`: empty, quotes, punctuation, unicode, 9th token dropped, AND join, no raw MATCH operators from user input.
- `store.test.ts`: upsert, same-path update, search, type filter, folder prefix with `_` in the name (must not match siblings), removeByPath + cover cleanup, removeByFolderPrefix + cover cleanup, movePath, copyPath, moveFolderPrefix, set/get/clear cover, invalid cursor.
- `storage-level.test.ts`: `canonicalizeStoragePath` cases listed above.
- `packages/ui/test/upload-batch.test.ts`: 127 files → 7 fetches; 429→success; persistent 429 stops later batches; malformed body; mixed errors; `retryAfterMs` clamp and past/malformed reset; Retry-After seconds and HTTP-date; X-RateLimit-Reset seconds vs ms.

### Integration

- `apps/api/src/routes/upload.test.ts`: fake `assetIndex.upsertFromUpload` called with final path; throw still yields HTTP 200.
- `apps/api/src/routes/assets-search.test.ts`: seed, search, type, folder, traversal 400, missing q 400, bad cursor 400, `_` in folder name.
- `apps/api/src/routes/folder-thumbnail.test.ts`: set cover, reject outside folder, reject video, reject directory, root cover, delete cover, Windows-style `..\` path.
- Rename/move/copy index tests against the storage route with a fake index (or store + temp dir).
- Delete: S3-folder early-return path still unindexes (unit-test `deleteAssetCompletely` with a fake storage `deleteFolder` + fake index).
- `reconcile.test.ts`: local temp dir 3 files; delete one from disk; second pass removes 1. Local walk throw → no deletes. S3 listing omit + success → **no** delete. S3 throw → no mass delete.
- Schema: memory db, `ensureAssetIndexSchema`, insert, FTS match, drop-trigger recovery.
- `raw.test.ts` and `http-range.test.ts` still pass.

### Manual (PR notes, not the merge gate)

- Upload a real folder of >127 files in the dashboard dialog once before merge if a running stack is available. The **blocking** gate is the mocked 127-file orchestrator.

Gates the implementer must run:

```
pnpm --filter @openinary/core test
pnpm --filter api test
pnpm --filter @openinary/ui test
pnpm --filter @openinary/core type-check
pnpm --filter api type-check
pnpm --filter @openinary/ui type-check
pnpm --filter web type-check
```

The orchestrator additionally runs `pnpm --filter api build` + `pnpm --filter @openinary/core build` + `pnpm --filter @openinary/ui build` + `pnpm --filter web type-check` + `pnpm --filter cloud-web type-check` (MediaGrid consumer) before merge. Full turbo `pnpm build` of cloud worker/docs is not required if those packages are untouched.

`iterPaths` must use keyset pagination (`path > last` ORDER BY path) so deleting rows during the pass cannot skip entries. Do not `SELECT path` the whole table into memory for large libraries.

---

## Implementation order (Grok slices)

Each slice is one Grok brief. Orchestrator reviews + commits between slices.

1. **Schema + store + FTS sanitizer + canonicalizeStoragePath + unit tests.** Switch core/api test scripts to Windows-safe globs.
2. **Hooks:** upload, delete (including S3-folder early return), rename, copy, move, async reconcile (local delete, S3 upsert-only), `POST /storage/reconcile`.
3. **HTTP:** `GET /assets/search`, folder thumbnail routes, listing `coverPath`. Path tests.
4. **UI hang fix:** `upload-batch.ts` + `packages/ui/test/upload-batch.test.ts` (127 files) + wire `upload-section.tsx`.
5. **UI search + folder cover** with `folderCoverEnabled` default false; self-hosted page turns it on.
6. **Orchestrator:** clean-code-guard, test-guard, Codex review, PR, CodeRabbit/CodexBot, merge.

Do not mix Cloud/Drizzle, overlays, tags UI, or custom metadata editor in this PR. `custom_metadata` column exists for FTS and future DAM; no dashboard editor in this work.

---

## Out of scope (explicit)

- Drizzle / Postgres migrations
- Cloud (`apps/cloud`) FTS
- Replacing `readdirSync` listing with the index
- Custom metadata editor in the details sidebar
- Changing `/t` or `/raw` or range parser
- File-uploader widget (`use-file-upload.ts`)
- Raising `PUBLIC_RATE_LIMIT_MAX`
- `init-db.ts` resurrection unless a one-line comment pointing at `shared/auth.ts` is useful — skip even that unless asked

---

## Spec coverage checklist

| Requirement | Task |
| --- | --- |
| `assets` table columns | Slice 1 |
| FTS5 on filename, path, custom_metadata | Slice 1 |
| Index on upload | Slice 2 |
| Unindex on delete (incl. S3 folder early return) | Slice 2 |
| Rename / copy / move keep the index coherent | Slice 2 |
| Reconcile walker local + S3, live listing untouched | Slice 2 |
| `GET /assets/search` | Slice 3 |
| Search bar + type filter | Slice 5 |
| Folder cover storage | Slice 1 + 3 |
| `POST/DELETE /folders/thumbnail` | Slice 3 |
| Context menu Set as Folder Cover | Slice 5 |
| Folder grid renders cover with fallback | Slice 5 |
| Bulk upload hang ~127 files | Slice 4 |
| `/t` and `/raw` unchanged | All slices; regression tests |

---

## Defaults accepted from Codex round 1

1. No Drizzle (D1) — confirmed by inspection.
2. `/assets/search` as requested, behind `apiKeyAuth`.
3. S3 reconcile is upsert-only; no listing-driven deletes.
4. Sequential batches of 20, not parallel.
5. Cloud cover UI stays off unless `folderCoverEnabled`.
6. Blocking 127-file test is a mocked orchestrator in `packages/ui/test/`, not Playwright. Codex asked for a browser test; this fork's UI package has no browser runner, so the orchestrator test is the enforceable equivalent.

## Codex round 2 (REJECT) — four remaining items folded in above

1. Base tables commit separately from FTS; FTS create/recreate runs `rebuild`.
2. `mtime` is on `AssetRecord` and the upload upsert.
3. Node 20 test runner: no globs; `scripts/run-node-tests.mjs` walker in core, api, and ui.
4. Cross-folder `movePath` clears cover rows; same-folder rename rewrites `cover_path`.

These are mandatory. Do not send a third debate round — implement them.

Residual risks we accept:

- Local reconcile on a huge tree is still work; chunking + yield keeps `/health` alive but first-time index may take minutes.
- S3 deletes that bypass `deleteAssetCompletely` (manual bucket edits) stay searchable until a future tombstone design. Out of scope.
- `custom_metadata` is stored and FTS-indexed but has no editor.
- 127-file gate is a mocked Node orchestrator, not Playwright.
