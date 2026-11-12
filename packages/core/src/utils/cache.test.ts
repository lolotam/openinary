import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCachePath } from './cache';

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
