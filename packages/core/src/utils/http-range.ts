/**
 * bytes=start-end / bytes=start- / bytes=-suffix, clamped to the object's
 * real size. Returns null for anything absent, malformed, multi-range or
 * unsatisfiable. Callers treat null as "serve the whole file".
 *
 * Mirrors the Cloud worker parser so /t/* and /b/* agree on what "bytes="
 * means. The worker cannot import this file (bundle size), so the two copies
 * have to stay in step by inspection.
 */
export function parseRangeHeader(
  header: string | null | undefined,
  totalSize: number,
): { offset: number; length: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;
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
  if (
    !Number.isFinite(offset) ||
    !Number.isFinite(end) ||
    offset < 0 ||
    offset > end
  ) {
    return null;
  }
  return { offset, length: end - offset + 1 };
}

export function formatContentRange(
  range: { offset: number; length: number },
  totalSize: number,
): string {
  return `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`;
}

export function formatBytesRange(range: { offset: number; length: number }): string {
  return `bytes=${range.offset}-${range.offset + range.length - 1}`;
}
