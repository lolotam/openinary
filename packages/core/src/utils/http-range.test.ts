import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatBytesRange,
  formatContentRange,
  parseRangeHeader,
  parseRangeRequest,
} from "./http-range";

test("parses a closed range", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-10", 100), {
    offset: 0,
    length: 11,
  });
  assert.deepEqual(parseRangeHeader("bytes=50-99", 100), {
    offset: 50,
    length: 50,
  });
});

test("parses an open-ended range", () => {
  assert.deepEqual(parseRangeHeader("bytes=90-", 100), {
    offset: 90,
    length: 10,
  });
});

test("parses a suffix range", () => {
  assert.deepEqual(parseRangeHeader("bytes=-10", 100), {
    offset: 90,
    length: 10,
  });
});

test("clamps the end to the last byte", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-999", 100), {
    offset: 0,
    length: 100,
  });
});

test("returns null for missing, malformed or unsatisfiable ranges", () => {
  assert.equal(parseRangeHeader(null, 100), null);
  assert.equal(parseRangeHeader(undefined, 100), null);
  assert.equal(parseRangeHeader("", 100), null);
  assert.equal(parseRangeHeader("bytes=", 100), null);
  assert.equal(parseRangeHeader("bytes=-", 100), null);
  assert.equal(parseRangeHeader("bytes=0-10,20-30", 100), null);
  assert.equal(parseRangeHeader("items=0-10", 100), null);
  assert.equal(parseRangeHeader("bytes=50-10", 100), null);
  assert.equal(parseRangeHeader("bytes=100-200", 100), null);
});

test("classifies unsatisfiable ranges separately from malformed ones", () => {
  assert.equal(parseRangeRequest(null, 100).status, "absent");
  assert.equal(parseRangeRequest("bytes=0-10,20-30", 100).status, "absent");
  assert.equal(parseRangeRequest("bytes=100-200", 100).status, "unsatisfiable");
  assert.equal(parseRangeRequest("bytes=50-10", 100).status, "unsatisfiable");
});

test("formats Content-Range and the S3 Range value", () => {
  const range = { offset: 10, length: 5 };
  assert.equal(formatContentRange(range, 100), "bytes 10-14/100");
  assert.equal(formatBytesRange(range), "bytes=10-14");
});
