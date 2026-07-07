import { test, expect } from '@playwright/test'
import { deriveCarFacets, type CarFacetInput } from '../lib/car-facets'
import { canonicalBrand, canonicalBrandKey } from '../lib/car-brands'

/**
 * cars-vertical · Sprint 1 — the pure facet deriver + brand canonicalizer.
 * All in the `api` gate; no network. The point is that messy real free-text
 * seller data (mixed casing, abbreviations, blanks, non-numeric junk, dupes)
 * still yields a clean, honest rail. Counts are full-catalog availability.
 */

test.describe('car-brands · canonicalBrandKey / canonicalBrand', () => {
  test('merges abbreviations + casing/accents into one key', () => {
    expect(canonicalBrandKey('VW')).toBe('volkswagen')
    expect(canonicalBrandKey('volkswagen')).toBe('volkswagen')
    expect(canonicalBrandKey('Volkswagén')).toBe('volkswagen')
    expect(canonicalBrandKey('Chevy')).toBe('chevrolet')
    expect(canonicalBrandKey('Mercedes Benz')).toBe('mercedes-benz')
  })

  test('unknown brand keys to its own normalized form (never dropped)', () => {
    expect(canonicalBrandKey('Cupra')).toBe('cupra')
    expect(canonicalBrandKey('  ')).toBe('')
  })

  // Drift guard — these alias mappings are a hand-maintained MIRROR of the backend
  // `_utils/car-listing.ts` BRAND_ALIAS_TO_KEY. If this frontend table drifts from
  // the backend, a facet option's count (grouped here) stops matching what the
  // backend `brand` filter returns. Any change to an alias must land in BOTH repos;
  // this pins the shared contract so a silent one-sided edit reds the FE gate.
  test('alias table matches the backend mirror (keep both repos in sync)', () => {
    const expected: Record<string, string> = {
      vw: 'volkswagen',
      chevy: 'chevrolet',
      mercedes: 'mercedes-benz',
      'mercedes benz': 'mercedes-benz',
      'general motors': 'gmc',
      'great wall': 'gwm',
    }
    for (const [input, key] of Object.entries(expected)) {
      expect(canonicalBrandKey(input), `alias "${input}" must map to "${key}" in both repos`).toBe(key)
    }
  })

  test('display gives proper casing for known brands, passes unknown through', () => {
    expect(canonicalBrand('vw')).toBe('Volkswagen')
    expect(canonicalBrand('BMW')).toBe('BMW')
    expect(canonicalBrand('seat')).toBe('SEAT')
    expect(canonicalBrand('mercedes benz')).toBe('Mercedes-Benz')
    expect(canonicalBrand('Rivian')).toBe('Rivian')   // unknown → as typed
  })
})

test.describe('deriveCarFacets · marca options + honest counts', () => {
  const pool: CarFacetInput[] = [
    { make: 'Volkswagen', model: 'Jetta', year: 2019, km: 48000, price_cents: 25000000 },
    { make: 'VW', model: 'Golf', year: 2020, km: 30000, price_cents: 31000000 },
    { make: 'volkswagen', model: 'Jetta', year: 2018, km: 62000, price_cents: 22000000 },
    { make: 'Nissan', model: 'Versa', year: 2021, km: 15000, price_cents: 28000000 },
    { make: '', model: '', year: null, km: null, price_cents: null },        // blank car
    { make: '  ', model: 'x', year: 2017, km: 90000, price_cents: 18000000 }, // whitespace make
  ]

  test('groups aliases/casing into one option with the right count', () => {
    const f = deriveCarFacets(pool)
    const vw = f.marca.find((o) => o.value === 'Volkswagen')
    expect(vw).toBeTruthy()
    expect(vw!.count).toBe(3)                 // Volkswagen + VW + volkswagen
    expect(f.marca.find((o) => o.label === 'Nissan')!.count).toBe(1)
  })

  test('drops blank/whitespace makes, sorts by count desc then label', () => {
    const f = deriveCarFacets(pool)
    expect(f.marca.map((o) => o.label)).toEqual(['Volkswagen', 'Nissan'])
    expect(f.total).toBe(6)                   // total pool size unaffected by blanks
  })

  test('the submitted value round-trips as the canonical brand (crawlable ?brand=)', () => {
    const f = deriveCarFacets(pool)
    expect(f.marca[0].value).toBe('Volkswagen')
  })
})

test.describe('deriveCarFacets · modelo (marca-scoped) + ranges', () => {
  const pool: CarFacetInput[] = [
    { make: 'Volkswagen', model: 'Jetta', year: 2019, km: 48000, price_cents: 25000000 },
    { make: 'VW', model: 'Jetta', year: 2020, km: 30000, price_cents: 31000000 },
    { make: 'Volkswagen', model: 'Golf', year: 2018, km: 62000, price_cents: 22000000 },
    { make: 'Nissan', model: 'Versa', year: 2021, km: 15000, price_cents: 28000000 },
  ]

  test('modelo is scoped to the selected marca and dedups on casing', () => {
    const f = deriveCarFacets(pool, { marca: 'volkswagen' })   // any spelling
    expect(f.modelo.map((o) => o.label).sort()).toEqual(['Golf', 'Jetta'])
    expect(f.modelo.find((o) => o.label === 'Jetta')!.count).toBe(2)
    // Nissan's Versa is excluded by the marca scope.
    expect(f.modelo.find((o) => o.label === 'Versa')).toBeUndefined()
  })

  test('without a marca scope, all models are listed', () => {
    const f = deriveCarFacets(pool)
    expect(f.modelo.map((o) => o.label).sort()).toEqual(['Golf', 'Jetta', 'Versa'])
  })

  test('año/km ranges + precio in pesos', () => {
    const f = deriveCarFacets(pool)
    expect(f.anio).toEqual({ min: 2018, max: 2021 })
    expect(f.km).toEqual({ min: 15000, max: 62000 })
    expect(f.precio).toEqual({ min: 220000, max: 310000 })   // cents → pesos
  })
})

test.describe('deriveCarFacets · tolerates missing / messy / empty', () => {
  test('empty pool yields empty rail, null ranges', () => {
    const f = deriveCarFacets([])
    expect(f).toEqual({ total: 0, marca: [], modelo: [], anio: null, precio: null, km: null })
  })

  test('non-numeric year/km are ignored in ranges (not coerced to 0)', () => {
    const f = deriveCarFacets([
      { make: 'Kia', model: 'Rio', year: 'nomás' as unknown as number, km: 'sin dato' as unknown as number, price_cents: 20000000 },
      { make: 'Kia', model: 'Rio', year: 2022, km: 12000, price_cents: 21000000 },
    ])
    expect(f.anio).toEqual({ min: 2022, max: 2022 })
    expect(f.km).toEqual({ min: 12000, max: 12000 })
    expect(f.marca[0].count).toBe(2)
  })

  test('a non-array input degrades to an empty rail (never throws)', () => {
    const f = deriveCarFacets(undefined as unknown as CarFacetInput[])
    expect(f.total).toBe(0)
  })
})
