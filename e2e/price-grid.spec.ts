import { test, expect } from '@playwright/test'
import {
  sanitizeTierLadder,
  readPriceGrid,
  resolveTierForQuantity,
  resolveVariantForOptions,
  unitPriceCentsFor,
  formatPriceGridAmount,
  type PriceGrid,
} from '../lib/price-grid'

/**
 * Custom print products · Sprint 2, Story 2.3.
 * Pure-logic guards on the price-grid deriver — the seam the PDP buy box and
 * the checkout page both trust to keep the pay-button total equal to the
 * summary. No network; deterministic.
 */

const LADDER = [
  { min_quantity: 1, max_quantity: 9, amount: 1000 },
  { min_quantity: 10, max_quantity: 49, amount: 800 },
  { min_quantity: 50, max_quantity: null, amount: 600 },
]

test.describe('price-grid · sanitizeTierLadder', () => {
  test('sorts and keeps well-formed tiers', () => {
    const shuffled = [LADDER[2], LADDER[0], LADDER[1]]
    expect(sanitizeTierLadder(shuffled)).toEqual(LADDER)
  })

  test('drops malformed entries without throwing', () => {
    expect(sanitizeTierLadder(null)).toEqual([])
    expect(sanitizeTierLadder(undefined)).toEqual([])
    expect(sanitizeTierLadder('not-an-array' as unknown)).toEqual([])
    expect(sanitizeTierLadder([
      { min_quantity: 0, amount: 100 }, // min_quantity < 1
      { min_quantity: 1, amount: -5 },  // non-positive amount
      { min_quantity: 1, amount: 100 }, // valid
    ])).toEqual([{ min_quantity: 1, max_quantity: null, amount: 100 }])
  })
})

test.describe('price-grid · resolveTierForQuantity — tier boundaries', () => {
  test('resolves at exact min/max edges', () => {
    expect(resolveTierForQuantity(LADDER, 1)?.amount).toBe(1000)
    expect(resolveTierForQuantity(LADDER, 9)?.amount).toBe(1000)
    expect(resolveTierForQuantity(LADDER, 10)?.amount).toBe(800)
    expect(resolveTierForQuantity(LADDER, 49)?.amount).toBe(800)
    expect(resolveTierForQuantity(LADDER, 50)?.amount).toBe(600)
  })

  test('the open-ended last tier matches arbitrarily large quantities', () => {
    expect(resolveTierForQuantity(LADDER, 10_000)?.amount).toBe(600)
  })

  test('re-resolves correctly across a quantity change (cart qty stepper)', () => {
    // Simulates a buyer stepping the PDP/checkout quantity up across a tier
    // boundary — each call is independent and must reflect the NEW quantity,
    // proving the deriver has no hidden state to go stale.
    expect(resolveTierForQuantity(LADDER, 9)?.amount).toBe(1000)
    expect(resolveTierForQuantity(LADDER, 10)?.amount).toBe(800)
    expect(resolveTierForQuantity(LADDER, 9)?.amount).toBe(1000) // stepping back down
  })

  test('no-tier ladder (empty) resolves to null — caller falls back to the flat price', () => {
    expect(resolveTierForQuantity([], 5)).toBeNull()
  })

  test('clamps a non-positive/fractional quantity to 1', () => {
    expect(resolveTierForQuantity(LADDER, 0)?.amount).toBe(1000)
    expect(resolveTierForQuantity(LADDER, -3)?.amount).toBe(1000)
    expect(resolveTierForQuantity(LADDER, 3.7)?.amount).toBe(1000)
  })
})

test.describe('price-grid · readPriceGrid', () => {
  const GRID: PriceGrid = {
    product_id: 'prod_1',
    variants: [
      { id: 'variant_a', options: { Tamaño: '5cm', Material: 'vinil' }, manage_inventory: true, tiers: LADDER },
      { id: 'variant_b', options: { Tamaño: '7.5cm', Material: 'holográfico' }, manage_inventory: true, tiers: [{ min_quantity: 1, max_quantity: null, amount: 1500 }] },
    ],
  }

  test('parses a well-formed {price_grid: {...}} API response', () => {
    const parsed = readPriceGrid({ price_grid: GRID })
    expect(parsed?.product_id).toBe('prod_1')
    expect(parsed?.variants).toHaveLength(2)
  })

  test('also accepts the bare grid object (no {price_grid} wrapper)', () => {
    expect(readPriceGrid(GRID)?.variants).toHaveLength(2)
  })

  test('drops a variant with no valid tiers; never throws on garbage input', () => {
    expect(readPriceGrid(null)).toBeNull()
    expect(readPriceGrid('nonsense')).toBeNull()
    expect(readPriceGrid({ product_id: 'prod_1', variants: [{ id: 'v1', options: {}, tiers: [] }] })?.variants).toHaveLength(0)
  })

  test('resolveVariantForOptions matches the exact combo', () => {
    const parsed = readPriceGrid(GRID)!
    expect(resolveVariantForOptions(parsed, { Tamaño: '5cm', Material: 'vinil' })?.id).toBe('variant_a')
    expect(resolveVariantForOptions(parsed, { Tamaño: '7.5cm', Material: 'holográfico' })?.id).toBe('variant_b')
    expect(resolveVariantForOptions(parsed, { Tamaño: '10cm', Material: 'vinil' })).toBeNull()
  })

  test('unitPriceCentsFor resolves the correct variant + tier together', () => {
    const parsed = readPriceGrid(GRID)!
    expect(unitPriceCentsFor(parsed, 'variant_a', 1)).toBe(1000)
    expect(unitPriceCentsFor(parsed, 'variant_a', 10)).toBe(800)
    expect(unitPriceCentsFor(parsed, 'variant_b', 100)).toBe(1500)
    expect(unitPriceCentsFor(parsed, 'unknown_variant', 1)).toBeNull()
  })
})

test.describe('price-grid · formatPriceGridAmount — MXN rounding', () => {
  test('formats whole-peso cents with no fractional artifacts', () => {
    expect(formatPriceGridAmount(1000)).toBe('$10.00')
    expect(formatPriceGridAmount(150000)).toBe('$1,500.00')
  })

  test('pay-button total equals summary across a tier boundary crossing', () => {
    // The exact house rule this deriver exists to protect: total at qty=9 vs
    // qty=10 must equal unit × qty for whichever tier is active — never a
    // stale/blended number.
    const at9 = resolveTierForQuantity(LADDER, 9)!.amount * 9
    const at10 = resolveTierForQuantity(LADDER, 10)!.amount * 10
    expect(at9).toBe(9000)
    expect(at10).toBe(8000)
    expect(formatPriceGridAmount(at9)).toBe('$90.00')
    expect(formatPriceGridAmount(at10)).toBe('$80.00')
  })
})
