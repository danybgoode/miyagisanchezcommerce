import { test, expect } from '@playwright/test'
import {
  buildVariantComboKey,
  cartesianCombos,
  sanitizeDimensions,
  validateDimensionsClient,
  parsePesosToCents,
  rowsFromTiers,
  buildTierLadder,
  tierRangeLabel,
  MAX_VARIANT_COMBOS,
} from '../lib/opciones'

/**
 * Custom print products · Story 2.4 (seller "Opciones" UI).
 * Pure-logic guards on the editor helpers — the client mirrors of the backend
 * contract (`seller-product-create.ts` combo keys/caps, `price-tiers.ts`
 * ladder rules). No network; deterministic.
 */

test.describe('opciones · buildVariantComboKey — must byte-match the backend', () => {
  test('sorts titles alphabetically and joins Title:Value with |', () => {
    // Same fixture as sprint-2.md's smoke payload: Material sorts before Tamaño.
    expect(buildVariantComboKey({ Tamaño: '5cm', Material: 'vinil' }))
      .toBe('Material:vinil|Tamaño:5cm')
    expect(buildVariantComboKey({ Material: 'vinil', Tamaño: '5cm' }))
      .toBe('Material:vinil|Tamaño:5cm')
  })

  test('single dimension', () => {
    expect(buildVariantComboKey({ Tamaño: '10cm' })).toBe('Tamaño:10cm')
  })
})

test.describe('opciones · cartesianCombos', () => {
  test('full cartesian product, first dimension varying slowest', () => {
    const combos = cartesianCombos([
      { title: 'Tamaño', values: ['5cm', '7.5cm'] },
      { title: 'Material', values: ['vinil', 'holográfico'] },
    ])
    expect(combos).toHaveLength(4)
    expect(combos[0]).toEqual({ Tamaño: '5cm', Material: 'vinil' })
    expect(combos[3]).toEqual({ Tamaño: '7.5cm', Material: 'holográfico' })
  })
})

test.describe('opciones · sanitizeDimensions + validateDimensionsClient', () => {
  test('trims, caps at 40 chars, de-dupes values case-insensitively', () => {
    const [dim] = sanitizeDimensions([
      { title: `  ${'x'.repeat(50)}  `, values: [' vinil ', 'VINIL', '', 'holográfico'] },
    ])
    expect(dim.title).toHaveLength(40)
    expect(dim.values).toEqual(['vinil', 'holográfico'])
  })

  test('rejects empty, duplicate-title, and valueless dimensions with es-MX messages', () => {
    expect(validateDimensionsClient([])).toMatchObject({ ok: false })
    expect(validateDimensionsClient([
      { title: 'Tamaño', values: ['5cm'] },
      { title: 'tamaño', values: ['7cm'] },
    ])).toMatchObject({ ok: false, message: 'La dimensión "tamaño" está repetida.' })
    expect(validateDimensionsClient([{ title: 'Tamaño', values: [] }]))
      .toMatchObject({ ok: false })
  })

  test(`rejects over ${MAX_VARIANT_COMBOS} combos (server cap mirror)`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`)
    const result = validateDimensionsClient([
      { title: 'A', values: many(8) },
      { title: 'B', values: many(8) }, // 64 > 60
    ])
    expect(result.ok).toBe(false)
  })
})

test.describe('opciones · parsePesosToCents', () => {
  test('pesos → integer cents, MXN rounding', () => {
    expect(parsePesosToCents('150')).toBe(15000)
    expect(parsePesosToCents('150.50')).toBe(15050)
    expect(parsePesosToCents('1,500')).toBe(150000)
    expect(parsePesosToCents('19.999')).toBe(2000) // rounds, never fractional cents
  })

  test('rejects zero/negative/garbage', () => {
    expect(parsePesosToCents('0')).toBeNull()
    expect(parsePesosToCents('-5')).toBeNull()
    expect(parsePesosToCents('')).toBeNull()
    expect(parsePesosToCents('abc')).toBeNull()
  })
})

test.describe('opciones · buildTierLadder — valid by construction', () => {
  test('a single row is a flat open-ended price', () => {
    expect(buildTierLadder([{ minRaw: '1', priceRaw: '20' }])).toEqual({
      ok: true,
      tiers: [{ min_quantity: 1, max_quantity: null, amount: 2000 }],
    })
  })

  test('derives each max from the next row start; last open-ended (sprint smoke ladder)', () => {
    const built = buildTierLadder([
      { minRaw: '1', priceRaw: '20' },
      { minRaw: '10', priceRaw: '16' },
      { minRaw: '50', priceRaw: '12' },
    ])
    expect(built).toEqual({
      ok: true,
      tiers: [
        { min_quantity: 1, max_quantity: 9, amount: 2000 },
        { min_quantity: 10, max_quantity: 49, amount: 1600 },
        { min_quantity: 50, max_quantity: null, amount: 1200 },
      ],
    })
  })

  test('sorts unordered rows before deriving (editing a middle "desde")', () => {
    const built = buildTierLadder([
      { minRaw: '50', priceRaw: '12' },
      { minRaw: '1', priceRaw: '20' },
      { minRaw: '10', priceRaw: '16' },
    ])
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.tiers.map(t => t.min_quantity)).toEqual([1, 10, 50])
      expect(built.tiers.map(t => t.max_quantity)).toEqual([9, 49, null])
    }
  })

  test('structural rejections: empty, first not 1, duplicate starts, bad price', () => {
    expect(buildTierLadder([])).toMatchObject({ ok: false })
    expect(buildTierLadder([{ minRaw: '5', priceRaw: '20' }]))
      .toMatchObject({ ok: false, message: 'El primer nivel debe empezar en 1 pieza.' })
    expect(buildTierLadder([
      { minRaw: '1', priceRaw: '20' },
      { minRaw: '1', priceRaw: '15' },
    ])).toMatchObject({ ok: false, message: 'Dos niveles no pueden empezar en la misma cantidad.' })
    expect(buildTierLadder([{ minRaw: '1', priceRaw: '0' }])).toMatchObject({ ok: false })
    expect(buildTierLadder([{ minRaw: '1.5', priceRaw: '20' }])).toMatchObject({ ok: false })
  })

  test('always satisfies the backend contiguity rule (each min = prev max + 1)', () => {
    const built = buildTierLadder([
      { minRaw: '25', priceRaw: '8' },
      { minRaw: '1', priceRaw: '10' },
      { minRaw: '100', priceRaw: '5' },
      { minRaw: '2', priceRaw: '9' },
    ])
    expect(built.ok).toBe(true)
    if (built.ok) {
      for (let i = 1; i < built.tiers.length; i++) {
        expect(built.tiers[i].min_quantity).toBe((built.tiers[i - 1].max_quantity as number) + 1)
      }
      expect(built.tiers[built.tiers.length - 1].max_quantity).toBeNull()
    }
  })
})

test.describe('opciones · rowsFromTiers + tierRangeLabel (editor round-trip)', () => {
  test('grid tiers → editable rows → same ladder back', () => {
    const tiers = [
      { min_quantity: 1, max_quantity: 9, amount: 2000 },
      { min_quantity: 10, max_quantity: null, amount: 1600 },
    ]
    const rebuilt = buildTierLadder(rowsFromTiers(tiers))
    expect(rebuilt).toEqual({ ok: true, tiers })
  })

  test('live range labels reflect the neighboring rows', () => {
    const rows = [
      { minRaw: '1', priceRaw: '20' },
      { minRaw: '10', priceRaw: '16' },
      { minRaw: '50', priceRaw: '12' },
    ]
    expect(tierRangeLabel(rows, 0)).toBe('1–9')
    expect(tierRangeLabel(rows, 1)).toBe('10–49')
    expect(tierRangeLabel(rows, 2)).toBe('50+')
    expect(tierRangeLabel([{ minRaw: '', priceRaw: '' }], 0)).toBe('—')
  })
})
