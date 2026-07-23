import { expect, test } from '@playwright/test'
import { deriveSaleFacts } from '../lib/merchant-lifecycle'

/**
 * Founding merchant activation operations · Sprint 3, Story 3.1 —
 * fixture-driven coverage of the first-sale / retained-30-days rule
 * `lib/merchant-commerce-facts.ts#loadCommerceFacts` and `lib/merchant-
 * lifecycle-sweep.ts#sweepMerchantLifecycle` both call through
 * `deriveSaleFacts` (`lib/merchant-lifecycle.ts` — zero-import, so every
 * boundary is reachable here with no network call, same convention as the
 * rest of that file).
 *
 * `lib/merchant-commerce-facts.ts` and `lib/merchant-relationship-
 * lifecycle.ts` themselves import `server-only`, which THROWS unconditionally
 * outside a webpack `react-server` build — they cannot be imported directly
 * by a plain-Node spec at all. Their DB/Medusa-touching behaviour (idempotent
 * replay via the `merchant_relationship_transitions` UNIQUE constraint, the
 * fail-closed reads) is covered by:
 *   - the pure decision logic they're built from
 *     (`e2e/merchant-stage.spec.ts` — `factsAtOrAbove`, `mergeStageFacts`,
 *     `shouldEmitStageTransition`),
 *   - the population-guard source-scans in `e2e/merchant-relationship-
 *     population-guards.spec.ts` (no mutation, no raw-shop-id call site),
 *   - and the route-guard specs in `e2e/relationship-reconciliation-
 *     routes.spec.ts`.
 * The end-to-end "a late fact repairs the projection with no duplicate
 * transition" claim needs a real database and is owed to Daniel as a browser/
 * production smoke (sprint-3.md's walkthrough step 3).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = 30 * DAY_MS

test.describe('deriveSaleFacts — no orders', () => {
  test('empty order list → neither fact', () => {
    expect(deriveSaleFacts([], new Date('2026-08-01T00:00:00.000Z'), WINDOW_MS)).toEqual({
      firstSaleAt: null,
      retainedAt: null,
    })
  })

  test('every order has an unparseable created_at → same as no orders', () => {
    const result = deriveSaleFacts(
      [{ created_at: 'not-a-date' }, { created_at: '' }],
      new Date('2026-08-01T00:00:00.000Z'),
      WINDOW_MS,
    )
    expect(result).toEqual({ firstSaleAt: null, retainedAt: null })
  })
})

test.describe('deriveSaleFacts — first sale', () => {
  test('one order → that order IS the first sale', () => {
    const result = deriveSaleFacts([{ created_at: '2026-07-01T10:00:00.000Z' }], new Date('2026-07-02T00:00:00.000Z'), WINDOW_MS)
    expect(result.firstSaleAt?.toISOString()).toBe('2026-07-01T10:00:00.000Z')
  })

  test('multiple orders out of order → the EARLIEST wins, not array order', () => {
    const result = deriveSaleFacts(
      [
        { created_at: '2026-07-15T00:00:00.000Z' },
        { created_at: '2026-07-01T00:00:00.000Z' }, // earliest, listed second
        { created_at: '2026-07-20T00:00:00.000Z' },
      ],
      new Date('2026-07-21T00:00:00.000Z'),
      WINDOW_MS,
    )
    expect(result.firstSaleAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  test('a mix of valid and unparseable timestamps ignores only the bad ones', () => {
    const result = deriveSaleFacts(
      [{ created_at: 'garbage' }, { created_at: '2026-07-05T00:00:00.000Z' }],
      new Date('2026-07-06T00:00:00.000Z'),
      WINDOW_MS,
    )
    expect(result.firstSaleAt?.toISOString()).toBe('2026-07-05T00:00:00.000Z')
  })
})

test.describe('deriveSaleFacts — retained 30 days (the boundary that matters)', () => {
  const firstSale = '2026-07-01T00:00:00.000Z'
  const firstSaleMs = Date.parse(firstSale)
  const markMs = firstSaleMs + WINDOW_MS // 2026-07-31T00:00:00.000Z

  test('before the 30-day mark, even if `now` is past it → not retained (no qualifying order)', () => {
    const result = deriveSaleFacts(
      [{ created_at: firstSale }],
      new Date(markMs + DAY_MS), // now is well past the mark
      WINDOW_MS,
    )
    expect(result.retainedAt).toBeNull()
  })

  test('a second order ONE DAY after first sale, then silence → NOT retained (the over-counting bug this guards)', () => {
    // The exact regression the sweep's own header documents: a first sale plus
    // one order the next day and nothing after must not read as "retained".
    const result = deriveSaleFacts(
      [{ created_at: firstSale }, { created_at: '2026-07-02T00:00:00.000Z' }],
      new Date(markMs + DAY_MS),
      WINDOW_MS,
    )
    expect(result.retainedAt).toBeNull()
  })

  test('a qualifying order EXACTLY ON the 30-day mark counts', () => {
    const result = deriveSaleFacts(
      [{ created_at: firstSale }, { created_at: new Date(markMs).toISOString() }],
      new Date(markMs),
      WINDOW_MS,
    )
    expect(result.retainedAt?.getTime()).toBe(markMs)
  })

  test('one day before the mark does NOT count', () => {
    const almostMark = new Date(markMs - DAY_MS).toISOString()
    const result = deriveSaleFacts([{ created_at: firstSale }, { created_at: almostMark }], new Date(markMs + DAY_MS), WINDOW_MS)
    expect(result.retainedAt).toBeNull()
  })

  test('`now` before the mark → never retained yet, regardless of order history', () => {
    const result = deriveSaleFacts(
      [{ created_at: firstSale }, { created_at: new Date(markMs).toISOString() }],
      new Date(markMs - DAY_MS), // "now" is still before the mark
      WINDOW_MS,
    )
    expect(result.retainedAt).toBeNull()
  })

  test('the EARLIEST qualifying order wins, not the latest', () => {
    const result = deriveSaleFacts(
      [
        { created_at: firstSale },
        { created_at: new Date(markMs + 5 * DAY_MS).toISOString() },
        { created_at: new Date(markMs + 1 * DAY_MS).toISOString() }, // earliest qualifying
        { created_at: new Date(markMs + 10 * DAY_MS).toISOString() },
      ],
      new Date(markMs + 20 * DAY_MS),
      WINDOW_MS,
    )
    expect(result.retainedAt?.getTime()).toBe(markMs + 1 * DAY_MS)
  })

  test('retainedAt is the REAL qualifying timestamp, never `now` — a late-recovered retention keeps its true date', () => {
    // The exact regression the sweep's header names: recovering an August
    // retention in October must record August, not the run time.
    const qualifying = new Date(markMs + 2 * DAY_MS)
    const result = deriveSaleFacts([{ created_at: firstSale }, { created_at: qualifying.toISOString() }], new Date(markMs + 60 * DAY_MS), WINDOW_MS)
    expect(result.retainedAt?.toISOString()).toBe(qualifying.toISOString())
  })
})

test.describe('deriveSaleFacts — idempotent, pure', () => {
  test('the same input twice produces byte-identical output', () => {
    const orders = [{ created_at: '2026-07-01T00:00:00.000Z' }, { created_at: '2026-08-05T00:00:00.000Z' }]
    const now = new Date('2026-08-10T00:00:00.000Z')
    const a = deriveSaleFacts(orders, now, WINDOW_MS)
    const b = deriveSaleFacts(orders, now, WINDOW_MS)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
