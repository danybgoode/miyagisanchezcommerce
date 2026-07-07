import { test, expect } from '@playwright/test'
import { resolveReorderTarget, buildReorderCheckoutPath, reorderPriceChangeNote } from '../lib/reorder'

/**
 * "Volver a pedir" (custom-print-products epic, Sprint 4 · Story 4.3) —
 * pure seam: which item gets reordered, the checkout URL it builds, and
 * the price-change disclosure. No DB, no Medusa, no browser.
 */

test.describe('reorder · resolveReorderTarget', () => {
  test('resolves the first item when it has a real variant_id', () => {
    const target = resolveReorderTarget([
      { product_id: 'prod_1', variant_id: 'variant_1', quantity: 25, unit_price_cents: 400, personalization: null },
    ])
    expect(target).toEqual({ listingId: 'prod_1', variantId: 'variant_1', quantity: 25 })
  })

  test('returns null for an empty/absent line_items array', () => {
    expect(resolveReorderTarget([])).toBeNull()
    expect(resolveReorderTarget(null)).toBeNull()
    expect(resolveReorderTarget(undefined)).toBeNull()
  })

  test('returns null for a legacy/plain order item with no variant_id', () => {
    const target = resolveReorderTarget([
      { product_id: 'prod_1', variant_id: null, quantity: 1, unit_price_cents: 500, personalization: null },
    ])
    expect(target).toBeNull()
  })

  test('returns null when product_id is missing (never builds a broken URL)', () => {
    const target = resolveReorderTarget([
      { product_id: null, variant_id: 'variant_1', quantity: 1, unit_price_cents: 500, personalization: null },
    ])
    expect(target).toBeNull()
  })

  test('clamps a non-positive/fractional quantity to a whole number ≥ 1', () => {
    expect(resolveReorderTarget([{ product_id: 'p', variant_id: 'v', quantity: 0, unit_price_cents: 1, personalization: null }])!.quantity).toBe(1)
    expect(resolveReorderTarget([{ product_id: 'p', variant_id: 'v', quantity: 3.7, unit_price_cents: 1, personalization: null }])!.quantity).toBe(3)
  })
})

test.describe('reorder · buildReorderCheckoutPath', () => {
  test('builds the same query-param shape the buy box itself navigates to', () => {
    const path = buildReorderCheckoutPath({ listingId: 'prod_1', variantId: 'variant_1', quantity: 25 })
    expect(path).toBe('/checkout?listingId=prod_1&variantId=variant_1&qty=25')
  })

  test('URL-encodes ids that need it', () => {
    const path = buildReorderCheckoutPath({ listingId: 'prod 1', variantId: 'variant/1', quantity: 1 })
    expect(path).toContain('listingId=prod%201')
    expect(path).toContain('variantId=variant%2F1')
  })
})

test.describe('reorder · reorderPriceChangeNote', () => {
  test('returns null when the current price is unresolvable', () => {
    expect(reorderPriceChangeNote(1000, null, 25, 'MXN')).toBeNull()
  })

  test('returns null when the price is unchanged — never a confusing "updated" note', () => {
    expect(reorderPriceChangeNote(1000, 1000, 25, 'MXN')).toBeNull()
  })

  test('states the new total when the tier price changed', () => {
    const note = reorderPriceChangeNote(1000, 1200, 25, 'MXN')
    expect(note).toContain('Precio actualizado')
    expect(note).toContain('$300.00') // 1200 cents * 25 units = $300 MXN
  })
})
