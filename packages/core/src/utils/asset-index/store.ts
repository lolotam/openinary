import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import logger, { serializeError } from "../logger";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  escapeLike,
  sanitizeFtsQuery,
} from "./fts-query";
import type {
  AssetIndex,
  AssetRecord,
  MediaType,
  SearchParams,
  SearchResult,
} from "./types";

type AssetRow = {
  id: string;
  path: string;
  filename: string;
  size: number;
  mime: string;
  media_type: MediaType;
  folder: string;
  content_hash: string | null;
  thumbnail_path: string | null;
  custom_metadata: string;
  mtime: number | null;
  created_at: number;
  updated_at: number;
};

function parentFolder(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "" : filePath.slice(0, i);
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function mapRow(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    path: row.path,
    filename: row.filename,
    size: row.size,
    mime: row.mime,
    mediaType: row.media_type,
    folder: row.folder,
    contentHash: row.content_hash,
    thumbnailPath: row.thumbnail_path,
    customMetadata: parseMetadata(row.custom_metadata),
    mtime: row.mtime,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function likePrefix(folder: string): string {
  return `${escapeLike(folder)}/%`;
}

export class SqliteAssetIndex implements AssetIndex {
  ftsAvailable: boolean;

  constructor(
    private db: Database.Database,
    ftsAvailable?: boolean,
  ) {
    this.ftsAvailable =
      ftsAvailable ?? this.detectFts();
  }

  private detectFts(): boolean {
    try {
      const row = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets_fts'",
        )
        .get();
      return Boolean(row);
    } catch {
      return false;
    }
  }

  upsertFromUpload(
    input: Omit<AssetRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): AssetRecord {
    const now = Date.now();
    const id = input.id ?? randomUUID();
    const metadata = JSON.stringify(input.customMetadata ?? {});
    const mtime =
      input.mtime == null ? null : Math.round(input.mtime);

    this.db
      .prepare(
        `INSERT INTO assets (
          id, path, filename, size, mime, media_type, folder,
          content_hash, thumbnail_path, custom_metadata, mtime,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          filename = excluded.filename,
          size = excluded.size,
          mime = excluded.mime,
          media_type = excluded.media_type,
          folder = excluded.folder,
          content_hash = excluded.content_hash,
          thumbnail_path = excluded.thumbnail_path,
          custom_metadata = excluded.custom_metadata,
          mtime = excluded.mtime,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.path,
        input.filename,
        input.size,
        input.mime,
        input.mediaType,
        input.folder,
        input.contentHash,
        input.thumbnailPath,
        metadata,
        mtime,
        now,
        now,
      );

    const row = this.db
      .prepare("SELECT * FROM assets WHERE path = ?")
      .get(input.path) as AssetRow;
    return mapRow(row);
  }

  movePath(from: string, to: string): void {
    if (from === to) return;

    const run = this.db.transaction(() => {
      const fromFolder = parentFolder(from);
      const toFolder = parentFolder(to);
      const filename = to.slice(to.lastIndexOf("/") + 1);
      const now = Date.now();

      if (fromFolder === toFolder) {
        this.db
          .prepare(
            "UPDATE folder_covers SET cover_path = ?, updated_at = ? WHERE cover_path = ?",
          )
          .run(to, now, from);
      } else {
        this.db
          .prepare("DELETE FROM folder_covers WHERE cover_path = ?")
          .run(from);
      }

      this.db
        .prepare(
          `UPDATE assets
           SET path = ?, filename = ?, folder = ?, updated_at = ?
           WHERE path = ?`,
        )
        .run(to, filename, toFolder, now, from);
    });

    run();
  }

  copyPath(from: string, to: string): void {
    const source = this.getByPath(from);
    if (!source) return;

    this.upsertFromUpload({
      path: to,
      filename: to.slice(to.lastIndexOf("/") + 1),
      size: source.size,
      mime: source.mime,
      mediaType: source.mediaType,
      folder: parentFolder(to),
      contentHash: source.contentHash,
      thumbnailPath: source.thumbnailPath,
      customMetadata: source.customMetadata,
      mtime: source.mtime,
    });
  }

  moveFolderPrefix(from: string, to: string): void {
    if (from === to || !from) return;

    const run = this.db.transaction(() => {
      const now = Date.now();
      const fromLen = from.length;
      const like = likePrefix(from);

      const assets = this.db
        .prepare(
          `SELECT path, folder, filename FROM assets
           WHERE path = ? OR path LIKE ? ESCAPE '\\'
              OR folder = ? OR folder LIKE ? ESCAPE '\\'`,
        )
        .all(from, like, from, like) as {
        path: string;
        folder: string;
        filename: string;
      }[];

      for (const row of assets) {
        const newPath = row.path === from || row.path.startsWith(from + "/")
          ? to + row.path.slice(fromLen)
          : row.path;
        const newFolder =
          row.folder === from || row.folder.startsWith(from + "/")
            ? to + row.folder.slice(fromLen)
            : row.folder;
        const newFilename = newPath.slice(newPath.lastIndexOf("/") + 1);
        this.db
          .prepare(
            `UPDATE assets
             SET path = ?, folder = ?, filename = ?, updated_at = ?
             WHERE path = ?`,
          )
          .run(newPath, newFolder, newFilename, now, row.path);
      }

      const covers = this.db
        .prepare(
          `SELECT folder, cover_path FROM folder_covers
           WHERE folder = ? OR folder LIKE ? ESCAPE '\\'
              OR cover_path = ? OR cover_path LIKE ? ESCAPE '\\'`,
        )
        .all(from, like, from, like) as {
        folder: string;
        cover_path: string;
      }[];

      for (const cover of covers) {
        const newFolder =
          cover.folder === from || cover.folder.startsWith(from + "/")
            ? to + cover.folder.slice(fromLen)
            : cover.folder;
        const newCover =
          cover.cover_path === from || cover.cover_path.startsWith(from + "/")
            ? to + cover.cover_path.slice(fromLen)
            : cover.cover_path;
        this.db
          .prepare("DELETE FROM folder_covers WHERE folder = ?")
          .run(cover.folder);
        this.db
          .prepare(
            `INSERT INTO folder_covers (folder, cover_path, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(folder) DO UPDATE SET
               cover_path = excluded.cover_path,
               updated_at = excluded.updated_at`,
          )
          .run(newFolder, newCover, now);
      }
    });

    run();
  }

  removeByPath(path: string): void {
    const run = this.db.transaction(() => {
      this.db.prepare("DELETE FROM folder_covers WHERE cover_path = ?").run(path);
      this.db.prepare("DELETE FROM assets WHERE path = ?").run(path);
    });
    run();
  }

  removeByFolderPrefix(folder: string): void {
    const run = this.db.transaction(() => {
      const like = likePrefix(folder);
      this.db
        .prepare(
          `DELETE FROM folder_covers
           WHERE folder = ? OR folder LIKE ? ESCAPE '\\'
              OR cover_path = ? OR cover_path LIKE ? ESCAPE '\\'`,
        )
        .run(folder, like, folder, like);
      this.db
        .prepare(
          `DELETE FROM assets
           WHERE path = ? OR path LIKE ? ESCAPE '\\'
              OR folder = ? OR folder LIKE ? ESCAPE '\\'`,
        )
        .run(folder, like, folder, like);
    });
    run();
  }

  search(params: SearchParams): SearchResult {
    const degraded: SearchResult = {
      results: [],
      nextCursor: null,
      degraded: true,
    };

    if (!this.ftsAvailable) {
      return degraded;
    }

    const match = sanitizeFtsQuery(params.q);
    if (!match) {
      return { results: [], nextCursor: null, degraded: false };
    }

    const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
    const conditions = ["assets_fts MATCH ?"];
    const values: unknown[] = [match];

    if (params.type) {
      conditions.push("assets.media_type = ?");
      values.push(params.type);
    }

    if (params.folder !== undefined) {
      conditions.push(
        "(assets.folder = ? OR assets.folder LIKE ? ESCAPE '\\')",
      );
      values.push(params.folder, likePrefix(params.folder));
    }

    if (params.cursor) {
      const cursor = decodeSearchCursor(params.cursor);
      if (!cursor) {
        throw new Error("invalid_cursor");
      }
      conditions.push(
        "(assets.updated_at < ? OR (assets.updated_at = ? AND assets.id < ?))",
      );
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }

    values.push(limit + 1);

    try {
      const rows = this.db
        .prepare(
          `SELECT assets.*
           FROM assets_fts
           JOIN assets ON assets.rowid = assets_fts.rowid
           WHERE ${conditions.join(" AND ")}
           ORDER BY assets.updated_at DESC, assets.id DESC
           LIMIT ?`,
        )
        .all(...values) as AssetRow[];

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        results: page.map(mapRow),
        nextCursor: hasMore && last
          ? encodeSearchCursor(last.updated_at, last.id)
          : null,
        degraded: false,
      };
    } catch (error) {
      logger.warn(
        { error: serializeError(error), q: params.q },
        "Asset FTS MATCH failed",
      );
      return degraded;
    }
  }

  getCover(folder: string): string | null {
    const row = this.db
      .prepare("SELECT cover_path FROM folder_covers WHERE folder = ?")
      .get(folder) as { cover_path: string } | undefined;
    return row?.cover_path ?? null;
  }

  setCover(folder: string, coverPath: string): void {
    this.db
      .prepare(
        `INSERT INTO folder_covers (folder, cover_path, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(folder) DO UPDATE SET
           cover_path = excluded.cover_path,
           updated_at = excluded.updated_at`,
      )
      .run(folder, coverPath, Date.now());
  }

  clearCover(folder: string): void {
    this.db.prepare("DELETE FROM folder_covers WHERE folder = ?").run(folder);
  }

  coversFor(folders: string[]): Map<string, string> {
    const map = new Map<string, string>();
    if (folders.length === 0) return map;
    const placeholders = folders.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT folder, cover_path FROM folder_covers WHERE folder IN (${placeholders})`,
      )
      .all(...folders) as { folder: string; cover_path: string }[];
    for (const row of rows) {
      map.set(row.folder, row.cover_path);
    }
    return map;
  }

  getByPath(path: string): AssetRecord | null {
    const row = this.db
      .prepare("SELECT * FROM assets WHERE path = ?")
      .get(path) as AssetRow | undefined;
    return row ? mapRow(row) : null;
  }

  *iterPaths(batchSize: number): Iterable<string> {
    const size = Math.max(1, batchSize);
    let last = "";
    for (;;) {
      const rows = this.db
        .prepare(
          "SELECT path FROM assets WHERE path > ? ORDER BY path LIMIT ?",
        )
        .all(last, size) as { path: string }[];
      if (rows.length === 0) break;
      for (const row of rows) {
        yield row.path;
      }
      last = rows[rows.length - 1].path;
    }
  }

  clearCoversMissingFrom(existingPaths: Set<string>): void {
    const rows = this.db
      .prepare("SELECT folder, cover_path FROM folder_covers")
      .all() as { folder: string; cover_path: string }[];
    const run = this.db.transaction(() => {
      for (const row of rows) {
        if (!existingPaths.has(row.cover_path)) {
          this.db
            .prepare("DELETE FROM folder_covers WHERE folder = ?")
            .run(row.folder);
        }
      }
    });
    run();
  }
}
