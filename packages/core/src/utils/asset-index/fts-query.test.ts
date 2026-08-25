import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  escapeLike,
  sanitizeFtsQuery,
} from "./fts-query";

test("sanitizeFtsQuery returns null for empty and punctuation-only input", () => {
  assert.equal(sanitizeFtsQuery(""), null);
  assert.equal(sanitizeFtsQuery("   "), null);
  assert.equal(sanitizeFtsQuery("***"), null);
  assert.equal(sanitizeFtsQuery('""'), null);
});

test("sanitizeFtsQuery strips quotes and punctuation and uses prefix terms", () => {
  assert.equal(sanitizeFtsQuery("hello"), `"hello"*`);
  assert.equal(sanitizeFtsQuery('he"llo'), `"hello"*`);
  assert.equal(sanitizeFtsQuery("cat, dog!"), `"cat"* AND "dog"*`);
});

test("sanitizeFtsQuery keeps unicode letters", () => {
  assert.equal(sanitizeFtsQuery("café naïve"), `"café"* AND "naïve"*`);
  assert.equal(sanitizeFtsQuery("東京"), `"東京"*`);
});

test("sanitizeFtsQuery drops the 9th token and joins with AND", () => {
  const q = "one two three four five six seven eight nine";
  const match = sanitizeFtsQuery(q);
  assert.equal(
    match,
    `"one"* AND "two"* AND "three"* AND "four"* AND "five"* AND "six"* AND "seven"* AND "eight"*`,
  );
  assert.equal(match?.includes("nine"), false);
});

test("sanitizeFtsQuery never passes raw MATCH operators through", () => {
  const match = sanitizeFtsQuery('foo OR bar AND NOT baz ^ "quoted"');
  assert.equal(
    match,
    `"foo"* AND "OR"* AND "bar"* AND "AND"* AND "NOT"* AND "baz"* AND "quoted"*`,
  );
  assert.ok(match);
  for (const part of match.split(" AND ")) {
    assert.match(part, /^"[^"]+"\*$/);
  }
  assert.equal(match.includes("^"), false);
});

test("escapeLike escapes backslash percent and underscore", () => {
  assert.equal(escapeLike("a_b%c\\d"), "a\\_b\\%c\\\\d");
});

test("search cursor round-trips and rejects invalid values", () => {
  const encoded = encodeSearchCursor(123, "abc");
  assert.deepEqual(decodeSearchCursor(encoded), { updatedAt: 123, id: "abc" });
  assert.equal(decodeSearchCursor("not-valid"), null);
  assert.equal(decodeSearchCursor(""), null);
});
