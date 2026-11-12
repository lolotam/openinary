import { test } from "node:test";
import assert from "node:assert/strict";
import { parseParams } from "./parser";

for (const segment of ["w_0", "w_4097", "h_100000"]) {
  test(`parseParams rejects out-of-range dimension ${segment}`, () => {
    assert.throws(
      () => parseParams(`/t/${segment}/photo.jpg`),
      /Invalid transform dimension/,
    );
  });
}

test("parseParams accepts the maximum width", () => {
  assert.equal(parseParams("/t/w_4096/photo.jpg").width, "4096");
});

test("parseParams keeps automatic dimensions working", () => {
  const params = parseParams("/t/w_auto,h_auto/photo.jpg");
  assert.equal(params.width, "auto");
  assert.equal(params.height, "auto");
});
