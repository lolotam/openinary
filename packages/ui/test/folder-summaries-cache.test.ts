import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFolderSummaryEpoch } from "../src/hooks/folder-summary-cache";

test("applyFolderSummaryEpoch clears known and pending when the epoch changes", () => {
  const known = new Set(["album"]);
  const pending = new Set(["other"]);
  const last = { current: 1 };
  assert.equal(applyFolderSummaryEpoch(1, last, known, pending), false);
  assert.equal(known.has("album"), true);

  assert.equal(applyFolderSummaryEpoch(2, last, known, pending), true);
  assert.equal(last.current, 2);
  assert.equal(known.size, 0);
  assert.equal(pending.size, 0);
});
