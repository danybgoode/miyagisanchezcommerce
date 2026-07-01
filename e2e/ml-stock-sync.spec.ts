import { test, expect } from '@playwright/test'
import {
  clampAvailable,
  applySale,
  shouldPushStock,
  isOrderApplied,
  recordAppliedOrder,
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

test.describe('ml-stock · applySale (delta model, no oversell)', () => {
  test('decrements by the sold quantity; never negative', () => {
    expect(applySale(5, 2)).toBe(3)
    expect(applySale(5, 5)).toBe(0)
    expect(applySale(2, 3)).toBe(0)
  })
  test('CONCURRENT CASE: ML sale applied to a Medusa already reduced by a Miyagi sale → correct remaining', () => {
    // baseline 5; Miyagi sold 3 → Medusa 2; ML sale of 2 as a delta → 0 (not min(2,3)=2)
    expect(applySale(2, 2)).toBe(0)
  })
  test('INVARIANT: over a grid, applySale(a,b) ≤ a and ≥ 0 — no path oversells', () => {
    for (let a = -2; a <= 15; a++) {
      for (let b = -2; b <= 15; b++) {
        const out = applySale(a, b)
        expect(out).toBeLessThanOrEqual(clampAvailable(a))
        expect(out).toBeGreaterThanOrEqual(0)
      }
    }
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
