import { test, expect } from '@playwright/test'
import {
  clampAvailable,
  reconcileStock,
  shouldPushStock,
  isProcessedNotification,
  recordProcessedNotification,
  PROCESSED_EVENTS_CAP,
  type ProcessedEvent,
} from '../lib/ml-stock'

/**
 * Mercado Libre two-way stock sync · Sprint 4 (epic 03 · mercadolibre-sync).
 *
 * The sync runs entirely in the Medusa backend — an `order.placed` subscriber +
 * the seller-edit path push stock OUT to ML, a public `/webhooks/mercadolibre`
 * route pulls ML sales INTO Medusa Inventory, and a reconcile job heals drift.
 * Those are backend writes on the Medusa service (unreachable from the `api`
 * runner, which targets the Next app), and they are gated by the global
 * `ml.sync_enabled` kill-switch (default OFF / fail-closed) + a per-seller enable.
 *
 * So this gate proves what the frontend can prove deterministically: the pure
 * correctness core (mirrored from the backend `modules/mercadolibre/sync-utils.ts`)
 * that guarantees **no path can oversell** — the reconcile conservative-minimum
 * (US-12), the outbound push idempotency (US-10), and the replay-safe inbound
 * dedupe ring (US-11).
 *
 * OWED TO DANIEL (correctness/oversell path — real ML sandbox, sprint-4.md smoke):
 * sell a linked item on ML → Miyagi decrements once; reduce Miyagi stock → ML
 * reflects once; inject drift → the reconcile job heals it; flip `ml.sync_enabled`
 * OFF → all sync halts. Concurrency/oversell can't be fully covered headlessly.
 */

// ── US-12: the oversell invariant ──────────────────────────────────────────────
test.describe('ml-stock · reconcileStock (no oversell, ever)', () => {
  test('equal sides → no change', () => {
    expect(reconcileStock({ medusaAvailable: 5, mlAvailable: 5 })).toEqual({ target: 5, drift: 0 })
  })
  test('ML lower (unrecorded ML sale) → target follows ML down', () => {
    expect(reconcileStock({ medusaAvailable: 10, mlAvailable: 7 })).toEqual({ target: 7, drift: 3 })
  })
  test('Medusa lower (unreflected Miyagi sale) → target follows Medusa down', () => {
    expect(reconcileStock({ medusaAvailable: 2, mlAvailable: 10 })).toEqual({ target: 2, drift: 8 })
  })
  test('both sides moved (near-simultaneous sales) → conservative minimum', () => {
    // both started at 5; ML sold 2 (→3), Miyagi sold 3 (→2) → remaining 2, never 3
    expect(reconcileStock({ medusaAvailable: 2, mlAvailable: 3 })).toEqual({ target: 2, drift: 1 })
  })

  test('INVARIANT: over a wide grid, target ≤ min(both) and ≥ 0 — no path oversells', () => {
    for (let m = -3; m <= 20; m++) {
      for (let l = -3; l <= 20; l++) {
        const { target } = reconcileStock({ medusaAvailable: m, mlAvailable: l })
        expect(target).toBeLessThanOrEqual(Math.min(clampAvailable(m), clampAvailable(l)))
        expect(target).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('clampAvailable never yields a negative / fractional / NaN quantity', () => {
    expect(clampAvailable(-3)).toBe(0)
    expect(clampAvailable(2.9)).toBe(2)
    expect(clampAvailable(null)).toBe(0)
    expect(clampAvailable(Number.NaN)).toBe(0)
  })
})

// ── US-10: outbound push idempotency ───────────────────────────────────────────
test.describe('ml-stock · shouldPushStock (burst-collapse + safe retry)', () => {
  test('never pushed → push; unchanged → skip; changed → push', () => {
    expect(shouldPushStock({ currentAvailable: 4 })).toBe(true)
    expect(shouldPushStock({ currentAvailable: 4, lastPushedAvailable: 4 })).toBe(false)
    expect(shouldPushStock({ currentAvailable: 3, lastPushedAvailable: 4 })).toBe(true)
  })
})

// ── US-11: replay-safe inbound dedupe ──────────────────────────────────────────
test.describe('ml-stock · processed-notification ring (replay = no-op)', () => {
  const now = '2026-06-30T00:00:00.000Z'

  test('a redelivered notification id is detected as processed', () => {
    const ring: ProcessedEvent[] = [{ id: 'wh_1', ts: now }]
    expect(isProcessedNotification(ring, 'wh_1')).toBe(true)
    expect(isProcessedNotification(ring, 'wh_2')).toBe(false)
    expect(isProcessedNotification(null, 'wh_1')).toBe(false)
  })

  test('recording appends new ids, ignores duplicates/blanks, and stays bounded', () => {
    let ring = recordProcessedNotification(null, 'wh_1', now)
    expect(ring).toEqual([{ id: 'wh_1', ts: now }])
    expect(recordProcessedNotification(ring, 'wh_1', now)).toBe(ring) // duplicate → unchanged
    expect(recordProcessedNotification(ring, '', now)).toBe(ring) // blank → unchanged
    for (let i = 0; i < PROCESSED_EVENTS_CAP + 10; i++) ring = recordProcessedNotification(ring, `n_${i}`, now)
    expect(ring.length).toBe(PROCESSED_EVENTS_CAP)
    expect(isProcessedNotification(ring, `n_${PROCESSED_EVENTS_CAP + 9}`)).toBe(true) // latest still remembered
  })
})
