/**
 * Mercado Libre two-way stock sync — pure decision mirror (Sprint 4).
 *
 * The sync itself runs entirely in the Medusa backend (an `order.placed`
 * subscriber + a public webhook + a reconcile job mutate Medusa Inventory and
 * write to ML — unreachable from, and never called by, the frontend). This module
 * is the FRONTEND MIRROR of the backend's `modules/mercadolibre/sync-utils.ts`
 * correctness core — the same relationship `lib/ml-health.ts` has to the backend
 * `_utils.ts` health deriver. It exists so the deterministic `api` gate can prove
 * the one invariant that matters, without a backend: **no path can oversell.**
 *
 * Keep it byte-for-byte equivalent to the backend seam. It is the authoritative
 * copy for tests; the backend copy is authoritative at runtime.
 */

/** Clamp any quantity to a safe non-negative integer (the last line of defense). */
export function clampAvailable(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

/**
 * The oversell-safe reconcile decision (US-12). The reconciled remaining is the
 * **conservative minimum** of the two observed available quantities — it never
 * exceeds either side and is never negative, so when both channels recorded a sale
 * the other hasn't seen yet, neither can oversell. `drift` = how far apart they were.
 */
export function reconcileStock(args: { medusaAvailable: number; mlAvailable: number }): {
  target: number
  drift: number
} {
  const m = clampAvailable(args.medusaAvailable)
  const l = clampAvailable(args.mlAvailable)
  return { target: Math.min(m, l), drift: Math.abs(m - l) }
}

/**
 * Outbound idempotency (US-10): only push to ML when the value changed since the
 * last successful push. Pushing the current absolute value means a burst collapses
 * to the latest value and a retried trigger is a no-op.
 */
export function shouldPushStock(args: {
  currentAvailable: number
  lastPushedAvailable?: number | null
}): boolean {
  const cur = clampAvailable(args.currentAvailable)
  if (args.lastPushedAvailable == null) return true
  return cur !== clampAvailable(args.lastPushedAvailable)
}

// ── Replay-safe inbound dedupe (US-11) ──────────────────────────────────────────
export type ProcessedEvent = { id: string; ts: string }
export const PROCESSED_EVENTS_CAP = 50

export function isProcessedNotification(
  processed: ProcessedEvent[] | null | undefined,
  id: string,
): boolean {
  if (!id) return false
  return Array.isArray(processed) && processed.some((e) => e.id === id)
}

export function recordProcessedNotification(
  processed: ProcessedEvent[] | null | undefined,
  id: string,
  now: string = new Date().toISOString(),
  cap: number = PROCESSED_EVENTS_CAP,
): ProcessedEvent[] {
  const base = Array.isArray(processed) ? processed : []
  if (!id || base.some((e) => e.id === id)) return base
  const next = [...base, { id, ts: now }]
  return next.length > cap ? next.slice(next.length - cap) : next
}
