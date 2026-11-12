import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { deleteCachedFiles, getCachePath, SmartCache } from './cache';

test('getCachePath distinguishes Arabic filenames with the same transform', () => {
  assert.notEqual(
    getCachePath('/t/w_300/صورة.jpg'),
    getCachePath('/t/w_300/لوجو.jpg'),
  );
});

test('getCachePath distinguishes spaces from underscores', () => {
  assert.notEqual(
    getCachePath('/t/w_300/a b.jpg'),
    getCachePath('/t/w_300/a_b.jpg'),
  );
});

test('getCachePath ignores leading slashes', () => {
  assert.equal(
    getCachePath('/t/w_300/photo.jpg'),
    getCachePath('t/w_300/photo.jpg'),
  );
});

test('getCachePath canonicalizes percent-encoded paths', () => {
  assert.equal(
    getCachePath('/t/w_300/a%20b.jpg'),
    getCachePath('t/w_300/a b.jpg'),
  );
});

test('getCachePath preserves the original extension', () => {
  assert.ok(getCachePath('/t/w_300/صورة.jpg').endsWith('.jpg'));
});


async function tempCacheDir(t: any): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openinary-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function cacheFileName(requestPath: string): string {
  return basename(getCachePath(requestPath));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('performCleanup deletes oldest files first and stops at 70% of the maximum', async (t) => {
  const dir = await tempCacheDir(t);
  const now = Date.now();
  const oldest = join(dir, 'oldest.jpg');
  const middle = join(dir, 'middle.jpg');
  const newest = join(dir, 'newest.jpg');
  await writeFile(oldest, Buffer.alloc(40));
  await writeFile(middle, Buffer.alloc(30));
  await writeFile(newest, Buffer.alloc(10));
  await utimes(oldest, new Date(now - 3000), new Date(now - 3000));
  await utimes(middle, new Date(now - 2000), new Date(now - 2000));
  await utimes(newest, new Date(now - 1000), new Date(now - 1000));

  await SmartCache.performCleanup(dir, 100);

  assert.equal(await fileExists(oldest), false);
  assert.equal(await fileExists(middle), true);
  assert.equal(await fileExists(newest), true);
});

test('performCleanup preserves young tmp files and deletes stale ones', async (t) => {
  const dir = await tempCacheDir(t);
  const young = join(dir, 'image.jpg.tmp-young');
  const stale = join(dir, 'image.jpg.tmp-stale');
  await writeFile(young, Buffer.alloc(10));
  await writeFile(stale, Buffer.alloc(10));
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(stale, twoHoursAgo, twoHoursAgo);

  await SmartCache.performCleanup(dir, 100);

  assert.equal(await fileExists(young), true);
  assert.equal(await fileExists(stale), false);
});

test('deleteCachedFiles matches an Arabic original path', async (t) => {
  const dir = await tempCacheDir(t);
  const cached = join(dir, cacheFileName('/t/w_300/photos/صورة.jpg'));
  await writeFile(cached, 'transformed');

  assert.equal(await deleteCachedFiles('photos/صورة.jpg', dir), 1);
  assert.equal(await fileExists(cached), false);
});

test('deleteCachedFiles deletes the exact short name without over-matching banana', async (t) => {
  const dir = await tempCacheDir(t);
  const exact = join(dir, cacheFileName('/t/w_200/a.jpg'));
  const banana = join(dir, cacheFileName('/t/w_200/banana.jpg'));
  await writeFile(exact, 'exact');
  await writeFile(banana, 'banana');

  assert.equal(await deleteCachedFiles('a.jpg', dir), 1);
  assert.equal(await fileExists(exact), false);
  assert.equal(await fileExists(banana), true);
});

test('deleteCachedFiles leaves a same-named file in another folder alone', async (t) => {
  const dir = await tempCacheDir(t);
  const exact = join(dir, cacheFileName('/t/w_200/album/a.jpg'));
  const otherFolder = join(dir, cacheFileName('/t/w_200/other/a.jpg'));
  await writeFile(exact, 'exact');
  await writeFile(otherFolder, 'other');

  assert.equal(await deleteCachedFiles('album/a.jpg', dir), 1);
  assert.deepEqual(await readdir(dir), [basename(otherFolder)]);
});
