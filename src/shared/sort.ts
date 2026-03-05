const SORT_HYSTERESIS_MS = 5_000;

/**
 * Compare two ISO 8601 timestamps with hysteresis for stable sorting.
 *
 * When the time difference exceeds `thresholdMs`, sorts by recency (descending).
 * When within the threshold, delegates to `tiebreaker` for a stable order.
 *
 * @param a - First ISO 8601 timestamp
 * @param b - Second ISO 8601 timestamp
 * @param tiebreaker - Pre-computed stable comparator value (used when timestamps are close)
 * @param thresholdMs - Hysteresis threshold in milliseconds (default: 5000)
 * @returns Negative/positive when timestamps differ by more than threshold (descending), otherwise tiebreaker value as-is
 */
export function compareWithHysteresis(
  a: string,
  b: string,
  tiebreaker: number,
  thresholdMs: number = SORT_HYSTERESIS_MS,
): number {
  const diff = new Date(b).getTime() - new Date(a).getTime();
  if (Math.abs(diff) <= thresholdMs) return tiebreaker;
  return diff > 0 ? 1 : -1;
}
