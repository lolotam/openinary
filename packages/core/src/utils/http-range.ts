/**
 * bytes=start-end / bytes=start- / bytes=-suffix, clamped to the object's
 * real size.
 *
 * - absent / malformed / multi-range → `absent` (callers serve the whole file)
 * - syntactically valid but past the object → `unsatisfiable` (HTTP 416)
 * - otherwise → `ok` with offset/length
 *
 * Mirrors the Cloud worker parser so /t/* and /b/* agree on what "bytes="
 * means. The worker cannot import this file (bundle size), so the two copies
 * have to stay in step by inspection.
 */
export type RangeRequest =
  | { status: "absent" }
  | { status: "unsatisfiable" }
  | { status: "ok"; offset: number; length: number };

export function parseRangeRequest(
  header: string | null | undefined,
  totalSize: number,
): RangeRequest {
  if (!header) return { status: "absent" };
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { status: "absent" };
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return { status: "absent" };
  let offset: number;
  let end: number;
  if (startStr === "") {
    offset = Math.max(0, totalSize - Number(endStr));
    end = totalSize - 1;
  } else {
    offset = Number(startStr);
    end =
      endStr === "" ? totalSize - 1 : Math.min(Number(endStr), totalSize - 1);
  }
  if (!Number.isFinite(offset) || !Number.isFinite(end) || offset < 0) {
    return { status: "absent" };
  }
  if (totalSize <= 0 || offset >= totalSize || offset > end) {
    return { status: "unsatisfiable" };
  }
  return { status: "ok", offset, length: end - offset + 1 };
}

/**
 * Convenience for callers that still treat unsatisfiable as "no range".
 * Prefer parseRangeRequest when 416 must be distinguished.
 */
export function parseRangeHeader(
  header: string | null | undefined,
  totalSize: number,
): { offset: number; length: number } | null {
  const parsed = parseRangeRequest(header, totalSize);
  return parsed.status === "ok"
    ? { offset: parsed.offset, length: parsed.length }
    : null;
}

export function formatContentRange(
  range: { offset: number; length: number },
  totalSize: number,
): string {
  return `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`;
}

export function formatUnsatisfiableRange(totalSize: number): string {
  return `bytes */${totalSize}`;
}

export function formatBytesRange(range: { offset: number; length: number }): string {
  return `bytes=${range.offset}-${range.offset + range.length - 1}`;
}
