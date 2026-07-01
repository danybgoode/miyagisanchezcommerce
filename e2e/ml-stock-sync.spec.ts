import { test, expect } from '@playwright/test'
import {
  clampAvailable,
  safeDecrement,
  shouldPushStock,
  isOrderApplied,
  recordAppliedOrder,
  isSoldOrderStatus,
  APPLIED_ORDERS_CAP,
  type AppliedOrder,
} from '../lib/ml-stock'

/**
 * Mercado Libre two-way stock sync · Sprint 4 (epic 03 · mercadolibre-sync).
 *
 * The sync runs entirely in the Medusa backend — an `order.placed` subscriber +
 * the seller-edit path mirror Medusa stock OUT to ML, a public
 * `/webhooks/mercadolibre` applies ML sales INTO Medusa as deltas, and a reconcile
 * job recovers missed sales + re-mirrors. Those are backend writes on the Medusa
 * service (unreachable from the `api` runner), gated by the global `ml.sync_enabled`
 * kill-switch (default OFF / fail-closed) + a per-seller enable.
 *
 * This gate proves what the frontend can prove deterministically: the pure
 * correctness core (mirrored from the backend `modules/mercadolibre/sync-utils.ts`)
 * that guarantees **no path can oversell** — the delta application (a sale
 * decrements by exactly the sold qty, never negative — US-11), exactly-once per ML
 * order id (US-11/12), and the outbound mirror idempotency (US-10).
 *
 * OWED TO DANIEL (correctness/oversell path — real ML sandbox, sprint-4.md smoke):
 * sell a linked item on ML → Miyagi decrements once; reduce Miyagi stock → ML
 * reflects once; drop a webhook → the reconcile job recovers the sale; flip
 * `ml.sync_enabled` OFF → all sync halts.
 */

test.describe('ml-stock · safeDecrement (relative, reservation-safe — no oversell)', () => {
  test('removes the sold quantity from available; preserves reservations', () => {
    expect(safeDecrement(5, 0, 2)).toBe(2)
    expect(safeDecrement(5, 1, 2)).toBe(2)
  })
  test('caps the decrement at available so available never goes negative', () => {
    expect(safeDecrement(5, 1, 6)).toBe(4) // only 4 available → remove 4, reserved intact
    expect(safeDecrement(3, 3, 2)).toBe(0)
  })
  test('INVARIANT: over a grid, 0 ≤ decrement ≤ available and ≤ soldQty', () => {
    for (let s = -2; s <= 12; s++) {
      for (let r = -2; r <= 12; r++) {
        for (let q = -2; q <= 12; q++) {
          const d = safeDecrement(s, r, q)
          const available = Math.max(0, clampAvailable(s) - clampAvailable(r))
          expect(d).toBeGreaterThanOrEqual(0)
          expect(d).toBeLessThanOrEqual(available)
          expect(d).toBeLessThanOrEqual(clampAvailable(q))
        }
      }
    }
  })
})

test.describe('ml-stock · isSoldOrderStatus (only paid consumes stock)', () => {
  test('paid → true; pending/cancelled → false', () => {
    expect(isSoldOrderStatus('paid')).toBe(true)
    expect(isSoldOrderStatus('payment_required')).toBe(false)
    expect(isSoldOrderStatus('cancelled')).toBe(false)
    expect(isSoldOrderStatus(null)).toBe(false)
  })
})

test.describe('ml-stock · shouldPushStock (outbound mirror idempotency)', () => {
  test('never pushed → push; unchanged → skip; changed → push', () => {
    expect(shouldPushStock({ currentAvailable: 4 })).toBe(true)
    expect(shouldPushStock({ currentAvailable: 4, lastPushedAvailable: 4 })).toBe(false)
    expect(shouldPushStock({ currentAvailable: 3, lastPushedAvailable: 4 })).toBe(true)
  })
})

test.describe('ml-stock · applied-order ring (exactly-once per ML order id)', () => {
  const now = '2026-06-30T00:00:00.000Z'

  test('a re-seen order id is detected as applied → no double-decrement', () => {
    const ring: AppliedOrder[] = [{ id: 'ord_1', ts: now }]
    expect(isOrderApplied(ring, 'ord_1')).toBe(true)
    expect(isOrderApplied(ring, 'ord_2')).toBe(false)
    expect(isOrderApplied(null, 'ord_1')).toBe(false)
  })

  test('recording appends new ids, ignores duplicates/blanks, and stays bounded', () => {
    let ring = recordAppliedOrder(null, 'ord_1', now)
    expect(ring).toEqual([{ id: 'ord_1', ts: now }])
    expect(recordAppliedOrder(ring, 'ord_1', now)).toBe(ring)
    expect(recordAppliedOrder(ring, '', now)).toBe(ring)
    for (let i = 0; i < APPLIED_ORDERS_CAP + 10; i++) ring = recordAppliedOrder(ring, `o_${i}`, now)
    expect(ring.length).toBe(APPLIED_ORDERS_CAP)
    expect(isOrderApplied(ring, `o_${APPLIED_ORDERS_CAP + 9}`)).toBe(true)
  })
})
