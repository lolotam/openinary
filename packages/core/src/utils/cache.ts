import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { CacheStats } from '../types';
import logger, { serializeError } from './logger';

// Cache directory
const CACHE_DIR = './cache';
const CACHE_MAX_SIZE_MB = Math.max(
  1,
  parseInt(process.env.CACHE_MAX_SIZE_MB ?? '2048', 10) || 2048,
);
const TMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

export class SmartCache {
  private static stats: CacheStats = {
    requests: new Map(),
    totalCacheSize: 0,
    maxCacheSize: CACHE_MAX_SIZE_MB * 1024 * 1024
  };

  static async trackRequest(filePath: string, fileSize: number): Promise<void> {
    const existing = this.stats.requests.get(filePath);
    if (existing) {
      existing.count++;
      existing.lastAccess = Date.now();
      existing.totalSize = fileSize;
    } else {
      this.stats.requests.set(filePath, {
        count: 1,
        lastAccess: Date.now(),
        totalSize: fileSize
      });
    }
  }

  static async shouldKeepLocal(filePath: string, _fileSize: number): Promise<boolean> {
    const stats = this.stats.requests.get(filePath);
    if (!stats) return false;

    // Keep if accessed more than once in the last hour
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    return stats.count > 1 && stats.lastAccess > oneHourAgo;
  }

  static async shouldCleanupCache(): Promise<boolean> {
    return this.stats.totalCacheSize > this.stats.maxCacheSize * 0.8;
  }

  static async performCleanup(
    cacheDir: string = CACHE_DIR,
    maxCacheSize?: number,
  ): Promise<void> {
    logger.info('Performing cache cleanup...');

    const entries = await listCacheEntries(cacheDir);
    if (entries === null) {
      this.stats.totalCacheSize = 0;
      return;
    }

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const targetSize = (maxCacheSize ?? this.stats.maxCacheSize) * 0.7;
    const tmpCutoff = Date.now() - TMP_FILE_MAX_AGE_MS;
    let totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
    let removedCount = 0;

    for (const entry of entries) {
      const isStaleTmp = entry.isTmp && entry.mtimeMs < tmpCutoff;
      if (entry.isTmp && !isStaleTmp) continue;
      if (!isStaleTmp && totalSize <= targetSize) continue;

      try {
        await fs.unlink(entry.filePath);
        totalSize -= entry.size;
        removedCount++;
      } catch (error) {
        logger.warn(
          { error: serializeError(error), cachePath: entry.filePath },
          'Failed to cleanup cache file',
        );
      }
    }

    this.stats.totalCacheSize = Math.max(0, totalSize);
    logger.info({ removedCount }, 'Cache cleanup completed');
  }
}

interface CacheEntry {
  filePath: string;
  size: number;
  mtimeMs: number;
  isTmp: boolean;
}

/** Files in the cache directory, or null when the directory does not exist. */
async function listCacheEntries(cacheDir: string): Promise<CacheEntry[] | null> {
  let files: string[];
  try {
    files = await fs.readdir(cacheDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const entries: CacheEntry[] = [];
  for (const file of files) {
    const filePath = join(cacheDir, file);
    try {
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        entries.push({
          filePath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          isTmp: file.includes('.tmp-'),
        });
      }
    } catch (error) {
      logger.warn({ error: serializeError(error), filePath }, 'Failed to stat cache file');
    }
  }
  return entries;
}

function sanitizeCachePath(requestPath: string): {
  canonicalPath: string;
  safePath: string;
} {
  let canonicalPath = requestPath.replace(/^\/+/, '');
  try {
    canonicalPath = decodeURIComponent(canonicalPath);
  } catch {
    // Keep the original form when the path contains invalid percent encoding.
  }
  const safePath = canonicalPath
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return { canonicalPath, safePath };
}

/**
 * Generate cache path for a given request path
 */
export function getCachePath(requestPath: string): string {
  // The readable part keeps cache files greppable and lets deleteCachedFiles
  // match them by name, but it is lossy: every non-ASCII character becomes
  // "_", so "/t/w_300/صورة.jpg" and "/t/w_300/لوجو.jpg" both reduce to
  // "t_w_300_.jpg". The hash of the canonical request path keeps them apart;
  // it sits before the extension so the entry still ends in its real format.
  const { canonicalPath, safePath } = sanitizeCachePath(requestPath);
  const hash = createHash('sha256').update(canonicalPath).digest('hex').slice(0, 16);
  const extIndex = safePath.lastIndexOf('.');
  const hashed =
    extIndex > 0
      ? `${safePath.slice(0, extIndex)}.${hash}${safePath.slice(extIndex)}`
      : `${safePath}.${hash}`;

  return join(CACHE_DIR, hashed);
}

/**
 * Check if a file exists in cache
 */
export async function existsInCache(cachePath: string): Promise<boolean> {
  try {
    await fs.access(cachePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save buffer to cache
 */
export async function saveToCache(cachePath: string, buffer: Buffer): Promise<void> {
  try {
    // Ensure cache directory exists
    const cacheDir = dirname(cachePath);
    if (!existsSync(cacheDir)) {
      await fs.mkdir(cacheDir, { recursive: true });
    }
    
    // Written to a temp file and renamed rather than written in place: rename
    // is atomic, so a concurrent existsInCache/readFromCache never observes a
    // half-written entry and hands back a truncated image.
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, buffer);
    await fs.rename(tmpPath, cachePath);

    // Update cache size tracking
    SmartCache['stats'].totalCacheSize += buffer.length;

    logger.debug({ cachePath, size: buffer.length }, 'Saved to cache');
  } catch (error) {
    logger.warn({ error: serializeError(error), cachePath }, 'Failed to save to cache');
  }
}

/**
 * Read buffer from cache
 */
export async function readFromCache(cachePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(cachePath);
  } catch (error) {
    logger.warn({ error: serializeError(error), cachePath }, 'Failed to read from cache');
    throw error;
  }
}

/**
 * Initialize cache directory
 */
export async function initializeCache(): Promise<void> {
  try {
    if (!existsSync(CACHE_DIR)) {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      logger.info({ cacheDir: CACHE_DIR }, 'Created cache directory');
    }
  } catch (error) {
    logger.warn({ error: serializeError(error), cacheDir: CACHE_DIR }, 'Failed to initialize cache directory');
  }
}

/**
 * Delete all cached files related to an original file path
 */
export async function deleteCachedFiles(
  originalPath: string,
  cacheDir: string = CACHE_DIR,
): Promise<number> {
  try {
    if (!existsSync(cacheDir)) {
      logger.debug({ originalPath }, 'Cache directory does not exist');
      return 0;
    }

    const files = await fs.readdir(cacheDir);
    const sanitizedOriginal = sanitizeCachePath(originalPath).safePath;
    let deletedCount = 0;

    for (const file of files) {
      const filePath = join(cacheDir, file);

      const readablePart = file.replace(/\.[0-9a-f]{16}(?=\.|$)/, '');
      const matchesOriginal =
        readablePart === sanitizedOriginal ||
        readablePart.endsWith(`_${sanitizedOriginal}`);
      if (!matchesOriginal) continue;

      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          await fs.unlink(filePath);
          SmartCache['stats'].totalCacheSize = Math.max(
            0,
            SmartCache['stats'].totalCacheSize - stats.size,
          );
          SmartCache['stats'].requests.delete(originalPath);
          deletedCount++;
          logger.debug({ file, originalPath }, 'Deleted cache file');
        }
      } catch (error) {
        logger.warn({ error: serializeError(error), file }, 'Failed to delete cache file');
      }
    }

    logger.info({ originalPath, deletedCount }, 'Deleted local cache files');
    return deletedCount;
  } catch (error) {
    logger.error({ error: serializeError(error), originalPath }, 'Failed to delete cached files');
    return 0;
  }
}

/**
 * Gets aggregate stats for the local cache directory
 */
export async function getCacheSize(
  cacheDir: string = CACHE_DIR,
): Promise<{ size: number; fileCount: number }> {
  try {
    if (!existsSync(cacheDir)) {
      return { size: 0, fileCount: 0 };
    }

    const files = await fs.readdir(cacheDir);
    let size = 0;
    let fileCount = 0;

    for (const file of files) {
      const filePath = join(cacheDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          size += stats.size;
          fileCount++;
        }
      } catch (error) {
        logger.warn({ error: serializeError(error), file }, 'Failed to stat cache file');
      }
    }

    return { size, fileCount };
  } catch (error) {
    logger.error({ error: serializeError(error) }, 'Failed to compute cache size');
    return { size: 0, fileCount: 0 };
  }
}

/**
 * Deletes all files in the local cache directory
 */
export async function clearAllCache(): Promise<number> {
  try {
    if (!existsSync(CACHE_DIR)) {
      return 0;
    }

    const files = await fs.readdir(CACHE_DIR);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = join(CACHE_DIR, file);
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      } catch (error) {
        logger.warn({ error: serializeError(error), file }, 'Failed to delete cache file');
      }
    }

    SmartCache['stats'].requests.clear();
    SmartCache['stats'].totalCacheSize = 0;

    logger.info({ deletedCount }, 'Cleared all local cache files');
    return deletedCount;
  } catch (error) {
    logger.error({ error: serializeError(error) }, 'Failed to clear cache');
    return 0;
  }
}

// Initialize cache on module load
initializeCache();
void getCacheSize().then(({ size }) => {
  SmartCache['stats'].totalCacheSize = size;
});