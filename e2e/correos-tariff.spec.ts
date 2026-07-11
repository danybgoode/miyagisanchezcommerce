import { test, expect } from '@playwright/test'
import { quoteCorreos, CORREOS_IMPRESOS_BANDS_2026, CORREOS_IMPRESOS_MAX_GRAMS } from '../lib/correos-tariff'

/**
 * Correos de México — Impresos en General tariff (frontend mirror). Spec-locked
 * band-by-band to `references/correos-de-mexico-impresos.pdf`, mirroring the backend
 * unit spec exactly (shipping-provider-expansion Sprint 3, Story 3.1).
 */

test.describe('quoteCorreos · band edges (pinned to the 2026 PDF)', () => {
  const cases: Array<[number, number]> = [
    [20, 600], [40, 700], [60, 800], [80, 900], [100, 950],
    [150, 1050], [200, 1150], [250, 1350], [300, 1450], [350, 1550],
    [400, 1700], [450, 1800], [500, 1850], [600, 1900], [700, 2000],
    [800, 2050], [900, 2150], [1000, 2250], [1100, 2300], [1200, 2350],
    [1300, 2400], [1400, 2450], [1500, 2500], [1600, 2600], [1700, 2650],
    [1800, 2700], [1900, 2800], [2000, 2900],
  ]

  for (const [grams, cents] of cases) {
    test(`exactly ${grams} g → ${cents} cents`, () => {
      expect(quoteCorreos(grams)).toEqual({ totalCents: cents, maxGrams: grams })
    })
  }

  test('has exactly 28 bands, matching the PDF row count', () => {
    expect(CORREOS_IMPRESOS_BANDS_2026).toHaveLength(28)
  })

  test('the table max is 2000 g', () => {
    expect(CORREOS_IMPRESOS_MAX_GRAMS).toBe(2000)
  })
})

test.describe('quoteCorreos · a weight inside a band rounds UP to that band, not down', () => {
  test('19 g and 1 g both land in the ≤20 g band', () => {
    expect(quoteCorreos(19)).toEqual({ totalCents: 600, maxGrams: 20 })
    expect(quoteCorreos(1)).toEqual({ totalCents: 600, maxGrams: 20 })
  })

  test('21 g lands in the >20–40 g band, not the ≤20 g band', () => {
    expect(quoteCorreos(21)).toEqual({ totalCents: 700, maxGrams: 40 })
  })

  test('1901 g lands in the final 1900–2000 g band', () => {
    expect(quoteCorreos(1901)).toEqual({ totalCents: 2900, maxGrams: 2000 })
  })
})

test.describe('quoteCorreos · out-of-table weights return null, never an invented price', () => {
  test('over the 2000 g max → null', () => {
    expect(quoteCorreos(2001)).toBeNull()
    expect(quoteCorreos(5000)).toBeNull()
  })

  test('non-positive → null', () => {
    expect(quoteCorreos(0)).toBeNull()
    expect(quoteCorreos(-1)).toBeNull()
  })

  test('non-finite → null', () => {
    expect(quoteCorreos(NaN)).toBeNull()
    expect(quoteCorreos(Infinity)).toBeNull()
  })
})
