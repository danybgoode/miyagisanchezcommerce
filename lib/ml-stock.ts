/**
 * Mercado Libre two-way stock sync — pure decision mirror (Sprint 4).
 *
 * The sync itself runs entirely in the Medusa backend (an `order.placed`
 * subscriber, a public webhook, and a reconcile job mutate Medusa Inventory and
 * write to ML — unreachable from, and never called by, the frontend). This module
 * is the FRONTEND MIRROR of the backend's `modules/mercadolibre/sync-utils.ts`
 * correctness core (as `lib/ml-health.ts` mirrors the backend `_utils.ts`), so the
 * deterministic `api` gate can prove the oversell invariant without a backend.
 *
 * The model is **delta / source-of-truth**, not absolute reconcile: comparing the
 * two channels' absolute quantities can't recover concurrent independent sales
 * (baseline 5, ML sells 2 → 3, Miyagi sells 3 → 2; true remaining is 0, but
 * `min(3,2)=2` — a 2-unit oversell). Each sale is applied to Medusa as a delta,
 * exactly once per ML order id.
 *
 * Keep this byte-for-byte equivalent to the backend seam. The backend unit spec
 * (`ml-sync.unit.spec.ts`) is authoritative for the runtime; this proves the same
 * invariants on the FE gate.
 */

/** Clamp any quantity to a safe non-negative integer (the last line of defense). */
export function clampAvailable(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

/**
 * How many units to remove from `stocked` for an ML sale of `soldQty`, given the
 * current `stocked`/`reserved` (US-11): the sold qty capped at the current
 * available (`stocked − reserved`), so the relative decrement never drives
 * available below 0 and always honors Medusa's own reservations. Mirrors the
 * backend runtime primitive exactly.
 */
export function safeDecrement(stocked: number, reserved: number, soldQty: number): number {
  const available = Math.max(0, clampAvailable(stocked) - clampAvailable(reserved))
  return Math.min(clampAvailable(soldQty), available)
}

/** Only a paid ML order consumed stock (a cancelled/pending order must not decrement). */
export function isSoldOrderStatus(status: string | null | undefined): boolean {
  return status === 'paid'
}

/**
 * Outbound mirror idempotency (US-10): only push Medusa's available to ML when it
 * changed since the last push (collapses bursts, safe on retry).
 */
export function shouldPushStock(args: {
  currentAvailable: number
  lastPushedAvailable?: number | null
}): boolean {
  const cur = clampAvailable(args.currentAvailable)
  if (args.lastPushedAvailable == null) return true
  return cur !== clampAvailable(args.lastPushedAvailable)
}

// ── Exactly-once sale application (US-11/12) ─────────────────────────────────────
// The dedupe key is the ML order id (the natural exactly-once key for a sale), so
// a redelivered webhook or a reconcile poll surfacing the same order applies once.
export type AppliedOrder = { id: string; ts: string }
export const APPLIED_ORDERS_CAP = 500

export function isOrderApplied(applied: AppliedOrder[] | null | undefined, orderId: string): boolean {
  if (!orderId) return false
  return Array.isArray(applied) && applied.some((o) => o.id === orderId)
}

export function recordAppliedOrder(
  applied: AppliedOrder[] | null | undefined,
  orderId: string,
  now: string = new Date().toISOString(),
  cap: number = APPLIED_ORDERS_CAP,
): AppliedOrder[] {
  const base = Array.isArray(applied) ? applied : []
  if (!orderId || base.some((o) => o.id === orderId)) return base
  const next = [...base, { id: orderId, ts: now }]
  return next.length > cap ? next.slice(next.length - cap) : next
}
