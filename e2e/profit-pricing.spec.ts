import { test, expect } from '@playwright/test'
import {
  solveForPrice,
  classifyMarginKillers,
  classifyUnderpriced,
  MARGIN_KILLER_THRESHOLD_PCT,
  type SkuMarginRow,
  type SolveForPriceInput,
} from '../lib/profit'

/**
 * Profit Analyzer · Sprint 2 · US-4/US-6 — the solve-for-price suggester and
 * the margin-insight classifiers. Both are pure, no I/O — pinned here per the
 * epic's own instruction ("unit specs pin the math incl. edge cases").
 */

const input = (over: Partial<SolveForPriceInput> = {}): SolveForPriceInput => ({
  cogsCents: 5000,
  shippingCents: 1000,
  fixedFeeCents: 500,
  feePct: 0.1,
  targetMarginPct: 0.2,
  ...over,
})

test.describe('profit · solveForPrice (US-4)', () => {
  test('hand math: price = (cogs + shipping + fixed_fee) / (1 - fee% - margin%)', () => {
    const result = solveForPrice(input())
    expect(result.achievable).toBe(true)
    if (result.achievable) {
      // (5000 + 1000 + 500) / (1 - 0.1 - 0.2) = 6500 / 0.7
      expect(result.priceCents).toBe(Math.round(6500 / 0.7))
    }
  })

  test('feePct = 0 reduces to cost / (1 - margin%)', () => {
    const result = solveForPrice(input({ feePct: 0 }))
    expect(result.achievable).toBe(true)
    if (result.achievable) expect(result.priceCents).toBe(Math.round(6500 / 0.8))
  })

  test('targetMarginPct = 0 reduces to cost / (1 - fee%)', () => {
    const result = solveForPrice(input({ targetMarginPct: 0 }))
    expect(result.achievable).toBe(true)
    if (result.achievable) expect(result.priceCents).toBe(Math.round(6500 / 0.9))
  })

  test('zero COGS (digital good) still solves for a price covering fee + margin', () => {
    const result = solveForPrice(input({ cogsCents: 0, shippingCents: 0, fixedFeeCents: 0 }))
    expect(result.achievable).toBe(true)
    if (result.achievable) expect(result.priceCents).toBe(0)
  })

  test('zero fixed fee omits it from the numerator', () => {
    const result = solveForPrice(input({ fixedFeeCents: 0 }))
    expect(result.achievable).toBe(true)
    if (result.achievable) expect(result.priceCents).toBe(Math.round(6000 / 0.7))
  })

  test('degenerate: fee% + margin% exactly 1 → not achievable', () => {
    const result = solveForPrice(input({ feePct: 0.8, targetMarginPct: 0.2 }))
    expect(result).toEqual({ achievable: false, reason: 'fee_plus_margin_exceeds_one' })
  })

  test('degenerate: fee% + margin% over 1 → not achievable', () => {
    const result = solveForPrice(input({ feePct: 0.7, targetMarginPct: 0.5 }))
    expect(result).toEqual({ achievable: false, reason: 'fee_plus_margin_exceeds_one' })
  })
})

const skuRow = (over: Partial<SkuMarginRow> = {}): SkuMarginRow => ({
  product_id: 'p1',
  variant_id: 'v1',
  title: 'Taza',
  units: 10,
  revenue_cents: 100000,
  fees_cents: 10000,
  cogs_cents: 40000,
  margin_cents: 50000,
  margin_pct: 0.5,
  pending: [],
  ...over,
})

test.describe('profit · classifyMarginKillers (US-6)', () => {
  test('flags a SKU below the margin-killer threshold', () => {
    const row = skuRow({ margin_pct: 0.03 })
    expect(classifyMarginKillers([row])).toEqual([row])
  })

  test('flags a loss-making (negative margin) SKU', () => {
    const row = skuRow({ margin_pct: -0.1, margin_cents: -1000 })
    expect(classifyMarginKillers([row])).toEqual([row])
  })

  test('does not flag a SKU at/above the threshold', () => {
    const row = skuRow({ margin_pct: MARGIN_KILLER_THRESHOLD_PCT })
    expect(classifyMarginKillers([row])).toEqual([])
  })

  test('excludes a row with a pending piece even if margin looks bad', () => {
    const row = skuRow({ margin_pct: 0.01, pending: ['cogs'] })
    expect(classifyMarginKillers([row])).toEqual([])
  })

  test('excludes a null margin_pct (zero revenue) row', () => {
    const row = skuRow({ margin_pct: null, revenue_cents: 0 })
    expect(classifyMarginKillers([row])).toEqual([])
  })
})

test.describe('profit · classifyUnderpriced (US-6)', () => {
  // Shared setup: unit cost 200¢, implied fee% 0.05 (fees_cents / revenue_cents).
  // Achievable price @ the ambitious 55% reference margin: 200 / (1-0.05-0.55) = 500¢.
  // margin_pct at a given unit price P: 1 - 0.05 - 200/P (fees scale with revenue).

  test('flags a comfortably-profitable SKU priced >10% below its ambitious-margin price', () => {
    // unit price 400 → margin_pct = 0.95 - 200/400 = 0.45 (≥ 0.40 gate). Achievable
    // @55% = 500; 400 < 500*(1-0.10)=450 → real headroom → flagged.
    const row = skuRow({
      units: 100, revenue_cents: 40000, fees_cents: 2000, cogs_cents: 20000, margin_pct: 0.45,
    })
    expect(classifyUnderpriced([row])).toEqual([row])
  })

  test('does not flag once price is within the 10% headroom band of the ambitious price', () => {
    // unit price 460 → margin_pct = 0.95 - 200/460 ≈ 0.515 (≥ 0.40 gate). Achievable
    // @55% = 500; 460 is NOT below 500*0.9=450 → no real headroom → not flagged.
    const row = skuRow({
      units: 100, revenue_cents: 46000, fees_cents: 2300, cogs_cents: 20000, margin_pct: 0.515,
    })
    expect(classifyUnderpriced([row])).toEqual([])
  })

  test('does not flag a SKU below the realized-margin floor, even with headroom', () => {
    // unit price 250 → margin_pct = 0.95 - 200/250 = 0.15, below the 0.40 gate —
    // excluded regardless of how much price headroom the formula would compute.
    const row = skuRow({
      units: 100, revenue_cents: 25000, fees_cents: 1250, cogs_cents: 20000, margin_pct: 0.15,
    })
    expect(classifyUnderpriced([row])).toEqual([])
  })

  test('excludes a row with a pending piece even if the math would otherwise flag it', () => {
    const row = skuRow({
      units: 100, revenue_cents: 40000, fees_cents: 2000, cogs_cents: 20000, margin_pct: 0.45,
      pending: ['ml_fee'],
    })
    expect(classifyUnderpriced([row])).toEqual([])
  })

  test('excludes a zero-unit or zero-revenue row', () => {
    const zeroUnits = skuRow({ units: 0, margin_pct: 0.6 })
    const zeroRevenue = skuRow({ revenue_cents: 0, margin_pct: null })
    expect(classifyUnderpriced([zeroUnits, zeroRevenue])).toEqual([])
  })
})
