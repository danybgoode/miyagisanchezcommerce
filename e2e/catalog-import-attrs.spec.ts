import { test, expect } from '@playwright/test'
import { validateRows, CATALOG_IMPORT_FIELDS } from '../lib/catalog-import'

/**
 * cars-vertical S2.3 — bulk import / agent-native setup autos vehicle-spec +
 * financing/trust mapping. `lib/catalog-import.ts` is composed verbatim into
 * the agent-native setup spec (lib/setup-spec.ts), so this is the one
 * canonical place these fields need coverage. Pure `validateRows()` block —
 * runs in the `api` gate.
 */

const baseAutosRow = {
  external_id: 'CAR-1',
  title: 'Toyota Corolla 2020 seminuevo',
  category: 'autos',
  price: 300000,
}

test.describe('catalog-import-attrs · autos fields are declared (S2.3)', () => {
  test('the 12 new autos columns are in CATALOG_IMPORT_FIELDS (agent-native setup composes this verbatim)', () => {
    const names = CATALOG_IMPORT_FIELDS.map(f => f.name)
    for (const field of [
      'make', 'model', 'year', 'km', 'fuel_type', 'transmission', 'color',
      'financing_down_payment_pct', 'financing_months', 'warranty_text', 'warranty_months', 'inspection_report_url',
    ]) {
      expect(names).toContain(field)
    }
  })
})

test.describe('catalog-import-attrs · brand canonicalization on stage (S2.3)', () => {
  test('an abbreviated marca ("vw") canonicalizes into attrs.make', () => {
    const [staged] = validateRows([{ ...baseAutosRow, make: 'vw', model: 'Golf' }])
    expect(staged.valid).toBe(true)
    expect(staged.row.attrs?.make).toBe('Volkswagen')
    expect(staged.row.attrs?.model).toBe('Golf')
  })

  test('an unrecognized marca passes through unchanged (graceful, never dropped)', () => {
    const [staged] = validateRows([{ ...baseAutosRow, make: 'Chirey' }])
    expect(staged.row.attrs?.make).toBe('Chirey')
  })
})

test.describe('catalog-import-attrs · merge-safety (S2.3)', () => {
  test('a row with no vehicle-spec/financing columns produces no attrs key at all', () => {
    const [staged] = validateRows([baseAutosRow])
    expect(staged.valid).toBe(true)
    expect(staged.row.attrs).toBeUndefined()
  })

  test('a non-autos row never assembles attrs even if the columns are present', () => {
    const [staged] = validateRows([{ ...baseAutosRow, category: 'deportes', make: 'vw' }])
    expect(staged.row.attrs).toBeUndefined()
  })

  test('only the columns present in the row land in attrs — others are simply absent, not null', () => {
    const [staged] = validateRows([{ ...baseAutosRow, year: 2020 }])
    expect(staged.row.attrs).toEqual({ year: 2020 })
  })
})

test.describe('catalog-import-attrs · enum + URL validation degrades gracefully (S2.3)', () => {
  test('an unknown fuel_type gets a warning and is dropped — the row still imports', () => {
    const [staged] = validateRows([{ ...baseAutosRow, fuel_type: 'gasolina_premium' }])
    expect(staged.valid).toBe(true)
    expect(staged.row.attrs?.fuel_type).toBeUndefined()
    expect(staged.issues.some(i => i.field === 'fuel_type' && i.level === 'warning')).toBe(true)
  })

  test('a known fuel_type/transmission pass straight through', () => {
    const [staged] = validateRows([{ ...baseAutosRow, fuel_type: 'hibrido', transmission: 'cvt' }])
    expect(staged.row.attrs?.fuel_type).toBe('hibrido')
    expect(staged.row.attrs?.transmission).toBe('cvt')
  })

  test('a malformed inspection_report_url gets a warning and is dropped — the row still imports', () => {
    const [staged] = validateRows([{ ...baseAutosRow, inspection_report_url: 'not-a-url' }])
    expect(staged.valid).toBe(true)
    expect(staged.row.attrs?.inspection_report_url).toBeUndefined()
    expect(staged.issues.some(i => i.field === 'inspection_report_url' && i.level === 'warning')).toBe(true)
  })

  test('a valid https inspection_report_url passes through into attrs', () => {
    const [staged] = validateRows([{ ...baseAutosRow, inspection_report_url: 'https://cdn.example.com/r.pdf' }])
    expect(staged.row.attrs?.inspection_report_url).toBe('https://cdn.example.com/r.pdf')
  })

  test('financing_down_payment_pct out of [0,100) is dropped with a warning, row still valid', () => {
    const [staged] = validateRows([{ ...baseAutosRow, financing_down_payment_pct: 150 }])
    expect(staged.valid).toBe(true)
    expect(staged.row.attrs?.financing_down_payment_pct).toBeUndefined()
  })

  test('a full autos row assembles every field into attrs', () => {
    const [staged] = validateRows([{
      ...baseAutosRow,
      make: 'Toyota', model: 'Corolla', year: 2020, km: 45000, fuel_type: 'gasolina', transmission: 'automatico', color: 'Blanco',
      financing_down_payment_pct: 20, financing_months: 48, warranty_text: '6 meses motor', warranty_months: 6,
      inspection_report_url: 'https://cdn.example.com/report.pdf',
    }])
    expect(staged.valid).toBe(true)
    expect(staged.row.attrs).toEqual({
      make: 'Toyota', model: 'Corolla', year: 2020, km: 45000, fuel_type: 'gasolina', transmission: 'automatico', color: 'Blanco',
      financing_down_payment_pct: 20, financing_months: 48, warranty_text: '6 meses motor', warranty_months: 6,
      inspection_report_url: 'https://cdn.example.com/report.pdf',
    })
  })
})
