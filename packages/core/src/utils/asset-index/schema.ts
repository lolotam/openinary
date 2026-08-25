import type Database from "better-sqlite3";
import logger, { serializeError } from "../logger";

const FTS_TRIGGERS = ["assets_ai", "assets_ad", "assets_au"] as const;

export function ensureAssetIndexBaseTables(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK (media_type IN ('image','video','raw')),
        folder TEXT NOT NULL,
        content_hash TEXT,
        thumbnail_path TEXT,
        custom_metadata TEXT NOT NULL DEFAULT '{}',
        mtime INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder);
      CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type);
      CREATE INDEX IF NOT EXISTS idx_assets_updated_at ON assets(updated_at);

      CREATE TABLE IF NOT EXISTS folder_covers (
        folder TEXT PRIMARY KEY,
        cover_path TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  })();
}

function ftsTableExists(db: Database.Database): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets_fts'",
    )
    .get() as { name: string } | undefined;
  return Boolean(row);
}

function ftsTriggersComplete(db: Database.Database): boolean {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('${FTS_TRIGGERS.join("','")}')`,
    )
    .all() as { name: string }[];
  return rows.length === FTS_TRIGGERS.length;
}

function dropFts(db: Database.Database): void {
  db.exec(`DROP TRIGGER IF EXISTS assets_ai`);
  db.exec(`DROP TRIGGER IF EXISTS assets_ad`);
  db.exec(`DROP TRIGGER IF EXISTS assets_au`);
  db.exec(`DROP TABLE IF EXISTS assets_fts`);
}

function createFts(db: Database.Database): void {
  db.exec(`
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
  `);
  db.exec(`INSERT INTO assets_fts(assets_fts) VALUES('rebuild')`);
}

export function ensureAssetIndexFts(db: Database.Database): boolean {
  try {
    const exists = ftsTableExists(db);
    if (exists && ftsTriggersComplete(db)) {
      return true;
    }
    if (exists) {
      dropFts(db);
    }
    createFts(db);
    return true;
  } catch (error) {
    logger.warn(
      { error: serializeError(error) },
      "SQLite FTS5 unavailable; asset search will be degraded",
    );
    return false;
  }
}

export function ensureAssetIndexSchema(
  db: Database.Database,
): { ftsAvailable: boolean } {
  ensureAssetIndexBaseTables(db);
  const ftsAvailable = ensureAssetIndexFts(db);
  return { ftsAvailable };
}
