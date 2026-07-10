import { test, expect } from '@playwright/test'
import { deriveProductMargin, resolveSuggestedPriceCandidate } from '../lib/catalog-margin'
import { MARGIN_KILLER_THRESHOLD_PCT, type SkuMarginRow } from '../lib/profit'

/**
 * Catalog-management epic · Sprint 4 · Story 4.1 — the catalog table's
 * margin-cell deriver. Pure, no I/O. Asserts the three honest states and
 * that the killer flag delegates to `classifyMarginKillers` rather than
 * re-encoding its threshold (per the sprint doc's "assert no formula fork").
 */

const row = (over: Partial<SkuMarginRow> = {}): SkuMarginRow => ({
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
  source: 'native',
  ...over,
})

test.describe('catalog-margin · deriveProductMargin (Story 4.1)', () => {
  test('no ledger row at all ⇒ no_sales, never a fake margin', () => {
    const info = deriveProductMargin('p1', [])
    expect(info.miyagi).toEqual({ state: 'no_sales', isKiller: false, pending: [] })
    expect(info.ml).toEqual({ state: 'no_sales', isKiller: false, pending: [] })
  })

  test('a row with pending cogs ⇒ no_cogs, never a fake margin', () => {
    const rows = [row({ source: 'native', pending: ['cogs'] })]
    const info = deriveProductMargin('p1', rows)
    expect(info.miyagi.state).toBe('no_cogs')
    expect(info.ml.state).toBe('no_sales') // no ML row at all — distinct state
  })

  test('a complete row computes a real margin, delegating the killer flag to classifyMarginKillers', () => {
    const rows = [row({ source: 'native', revenue_cents: 100000, fees_cents: 10000, cogs_cents: 40000, margin_pct: 0.5 })]
    const info = deriveProductMargin('p1', rows)
    expect(info.miyagi.state).toBe('computed')
    expect(info.miyagi.marginCents).toBe(100000 - 10000 - 40000)
    expect(info.miyagi.marginPct).toBeCloseTo(0.5)
    expect(info.miyagi.isKiller).toBe(false)
  })

  test('a margin-killer row (below the 5% threshold) is flagged via the real classifier', () => {
    // revenue 100, cogs 96 → margin 4 → 4% < MARGIN_KILLER_THRESHOLD_PCT (5%).
    const rows = [row({ source: 'native', revenue_cents: 10000, fees_cents: 0, cogs_cents: 9600 })]
    const info = deriveProductMargin('p1', rows)
    expect(info.miyagi.marginPct).toBeLessThan(MARGIN_KILLER_THRESHOLD_PCT)
    expect(info.miyagi.isKiller).toBe(true)
  })

  test('a product sold on BOTH channels gets independent Miyagi and ML cells', () => {
    const rows = [
      row({ source: 'native', revenue_cents: 20000, fees_cents: 0, cogs_cents: 9000 }),
      row({ source: 'mercadolibre', variant_id: 'v1', revenue_cents: 15000, fees_cents: 2000, cogs_cents: 0, pending: [] }),
    ]
    const info = deriveProductMargin('p1', rows)
    expect(info.miyagi.state).toBe('computed')
    expect(info.miyagi.marginCents).toBe(20000 - 9000)
    expect(info.ml.state).toBe('computed')
    expect(info.ml.marginCents).toBe(15000 - 2000)
  })

  test('multi-variant rows for the same product+channel aggregate into one cell', () => {
    const rows = [
      row({ source: 'native', variant_id: 'v1', revenue_cents: 10000, fees_cents: 0, cogs_cents: 4000 }),
      row({ source: 'native', variant_id: 'v2', revenue_cents: 5000, fees_cents: 0, cogs_cents: 1000 }),
    ]
    const info = deriveProductMargin('p1', rows)
    expect(info.miyagi.state).toBe('computed')
    expect(info.miyagi.marginCents).toBe((10000 - 4000) + (5000 - 1000))
    expect(info.miyagi.marginPct).toBeCloseTo((15000 - 5000) / 15000)
  })

  test('a non-cogs pending piece (ml_fee) is surfaced as a note, not a blocking state', () => {
    const rows = [row({ source: 'mercadolibre', pending: ['ml_fee'] })]
    const info = deriveProductMargin('p1', rows)
    expect(info.ml.state).toBe('computed')
    expect(info.ml.pending).toEqual(['ml_fee'])
  })

  test('rows for a different product are ignored entirely', () => {
    const rows = [row({ product_id: 'p2', source: 'native' })]
    const info = deriveProductMargin('p1', rows)
    expect(info.miyagi.state).toBe('no_sales')
  })
})

test.describe('catalog-margin · resolveSuggestedPriceCandidate (Story 4.2)', () => {
  test('a single, complete Miyagi-channel row resolves to a candidate', () => {
    const rows = [row({ source: 'native', variant_id: 'v1', units: 10, revenue_cents: 100000, cogs_cents: 40000, pending: [] })]
    const candidate = resolveSuggestedPriceCandidate('p1', rows)
    expect(candidate).toEqual({ productId: 'p1', variantId: 'v1', costPerUnitCents: 4000 })
  })

  test('never sold (no matching row) ⇒ ineligible', () => {
    expect(resolveSuggestedPriceCandidate('p1', [])).toBeNull()
  })

  test('multi-variant product with sales on more than one variant ⇒ ambiguous, ineligible', () => {
    const rows = [
      row({ source: 'native', variant_id: 'v1' }),
      row({ source: 'native', variant_id: 'v2' }),
    ]
    expect(resolveSuggestedPriceCandidate('p1', rows)).toBeNull()
  })

  test('a ML-channel-only row is ignored — Miyagi price is what this action targets', () => {
    const rows = [row({ source: 'mercadolibre', variant_id: 'v1' })]
    expect(resolveSuggestedPriceCandidate('p1', rows)).toBeNull()
  })

  test('pending cogs ⇒ ineligible, never a guessed cost', () => {
    const rows = [row({ source: 'native', variant_id: 'v1', pending: ['cogs'] })]
    expect(resolveSuggestedPriceCandidate('p1', rows)).toBeNull()
  })

  test('zero units or zero revenue ⇒ ineligible (no reliable realized price)', () => {
    expect(resolveSuggestedPriceCandidate('p1', [row({ source: 'native', variant_id: 'v1', units: 0 })])).toBeNull()
    expect(resolveSuggestedPriceCandidate('p1', [row({ source: 'native', variant_id: 'v1', revenue_cents: 0 })])).toBeNull()
  })

  test('missing variant_id ⇒ ineligible (nothing addressable to price)', () => {
    expect(resolveSuggestedPriceCandidate('p1', [row({ source: 'native', variant_id: null })])).toBeNull()
  })
})
