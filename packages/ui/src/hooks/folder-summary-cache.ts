export function applyFolderSummaryEpoch(
  epoch: number,
  lastEpoch: { current: number },
  known: Set<string>,
  pending: Set<string>,
): boolean {
  if (epoch === lastEpoch.current) return false;
  lastEpoch.current = epoch;
  known.clear();
  pending.clear();
  return true;
}
