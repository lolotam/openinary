const TOKEN_PATTERN = /[^\p{L}\p{N}\s]+/gu;
const MAX_TOKENS = 8;

export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function sanitizeFtsQuery(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/"/g, "")
    .replace(TOKEN_PATTERN, " ");
  if (!stripped) return null;

  const tokens = stripped
    .split(/\s+/u)
    .map((token) => token.replace(/"/g, ""))
    .filter((token) => token.length >= 1)
    .slice(0, MAX_TOKENS);

  if (tokens.length === 0) return null;

  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export function encodeSearchCursor(updatedAt: number, id: string): string {
  return Buffer.from(`${updatedAt}\n${id}`, "utf8").toString("base64url");
}

export function decodeSearchCursor(
  cursor: string,
): { updatedAt: number; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.indexOf("\n");
    if (sep <= 0) return null;
    const updatedAt = Number(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (!Number.isFinite(updatedAt) || !id) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}
