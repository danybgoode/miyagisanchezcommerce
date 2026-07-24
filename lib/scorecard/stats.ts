/**
 * lib/scorecard/stats.ts
 *
 * Merchant activation scorecard · Sprint 1, Story 1.2 — pure median/p90
 * helpers the resolver's aging and activation-time metrics share. Zero-
 * import, same convention as `lib/relationship-pipeline.ts`.
 */

/** Median of `values`. `null` on an empty array — the resolver treats that
 *  as "no data points", never as 0 (SD4). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The `p`-th percentile (nearest-rank method) of `values`, `p` in [0, 100].
 *  `null` on an empty array. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  const idx = Math.min(sorted.length - 1, Math.max(0, rank))
  return sorted[idx]
}
