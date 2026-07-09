import { expect, test } from '@playwright/test'
import {
  buildExportRows,
  rowsToCsv,
  csvToImportedRows,
  rowsToSheetJson,
  sheetJsonToImportedRows,
  rowsToJsonTree,
  jsonTreeToImportedRows,
  diffImport,
  buildDefaultsMap,
  type CopyExportRow,
} from '../lib/copy-overrides-import'
import type { OverrideRow } from '../lib/copy-overrides-merge'

// Pure-seam coverage for the bulk export/import/diff logic (epic 08 ·
// admin-content-and-announcements, Sprint 1). No browser, no network, no `xlsx`
// import — proves the flatten/round-trip/diff decisions the export + import
// routes compose.

const esDict = {
  sellerAcquisition: {
    anchor: { heroTitle: 'Vende lo que sea en México. 0% de comisión.' },
  },
  terms: { title: 'Terminos de uso' },
}

const enDict = {
  sellerAcquisition: {
    anchor: { heroTitle: 'Sell anything in Mexico. 0% commission.' }, // exists in en.json but sellerAcquisition is NOT bilingual
  },
  terms: { title: 'Terms of use' },
}

test.describe('buildExportRows', () => {
  test('emits an es row for every leaf, and an en row ONLY for a bilingual namespace', () => {
    const rows = buildExportRows(esDict, enDict, [])
    const byPath = new Map(rows.map((r) => [`${r.namespace}.${r.key}.${r.locale}`, r]))

    expect(byPath.has('sellerAcquisition.anchor.heroTitle.es')).toBe(true)
    expect(byPath.has('sellerAcquisition.anchor.heroTitle.en')).toBe(false) // es-only namespace
    expect(byPath.has('terms.title.es')).toBe(true)
    expect(byPath.has('terms.title.en')).toBe(true) // bilingual-allow-listed
  })

  test('the exported `value` is the override when present, else the default', () => {
    const overrides: OverrideRow[] = [
      { namespace: 'terms', key: 'title', locale: 'es', value: 'Reglas del sitio' },
    ]
    const rows = buildExportRows(esDict, enDict, overrides)
    const termsEs = rows.find((r) => r.namespace === 'terms' && r.locale === 'es')!
    expect(termsEs.default).toBe('Terminos de uso')
    expect(termsEs.value).toBe('Reglas del sitio')

    const anchorEs = rows.find((r) => r.namespace === 'sellerAcquisition' && r.locale === 'es')!
    expect(anchorEs.value).toBe(anchorEs.default) // no override → value falls back to default
  })

  test('scope filters by namespace and/or section', () => {
    const rows = buildExportRows(esDict, enDict, [], { namespace: 'terms' })
    expect(rows.every((r) => r.namespace === 'terms')).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })
})

test.describe('CSV round-trip', () => {
  test('rowsToCsv → csvToImportedRows recovers the same namespace/key/locale/value', () => {
    const rows: CopyExportRow[] = [
      { namespace: 'terms', key: 'title', locale: 'es', default: 'Terminos de uso', value: 'Reglas, del sitio "oficial"' },
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', default: 'x', value: 'y' },
    ]
    const csv = rowsToCsv(rows)
    const imported = csvToImportedRows(csv)
    expect(imported).toEqual([
      { namespace: 'terms', key: 'title', locale: 'es', value: 'Reglas, del sitio "oficial"' },
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'y' },
    ])
  })

  test('csvToImportedRows returns [] for a header-only or malformed file', () => {
    expect(csvToImportedRows('namespace,key,locale,default,value')).toEqual([])
    expect(csvToImportedRows('not,the,right,headers\na,b,c,d')).toEqual([])
    expect(csvToImportedRows('')).toEqual([])
  })
})

test.describe('XLSX row-object round-trip (SheetJS itself lives in the route)', () => {
  test('rowsToSheetJson → sheetJsonToImportedRows recovers the same rows', () => {
    const rows: CopyExportRow[] = [
      { namespace: 'terms', key: 'title', locale: 'es', default: 'Terminos de uso', value: 'Nuevo título' },
    ]
    const sheet = rowsToSheetJson(rows)
    const imported = sheetJsonToImportedRows(sheet)
    expect(imported).toEqual([{ namespace: 'terms', key: 'title', locale: 'es', value: 'Nuevo título' }])
  })
})

test.describe('JSON structure-true round-trip', () => {
  test('rowsToJsonTree → jsonTreeToImportedRows recovers the same rows, nested by namespace/locale', () => {
    const rows: CopyExportRow[] = [
      { namespace: 'terms', key: 'title', locale: 'es', default: 'x', value: 'Título nuevo' },
      { namespace: 'terms', key: 'title', locale: 'en', default: 'x', value: 'New title' },
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', default: 'x', value: 'Vende ya' },
    ]
    const tree = rowsToJsonTree(rows)
    expect(tree.terms.es).toEqual({ title: 'Título nuevo' })
    expect(tree.terms.en).toEqual({ title: 'New title' })
    expect(tree.sellerAcquisition.es).toEqual({ anchor: { heroTitle: 'Vende ya' } })
    expect(tree.sellerAcquisition.en).toBeUndefined() // no en rows for this namespace → key omitted

    const imported = jsonTreeToImportedRows(tree)
    const byPath = new Map(imported.map((r) => [`${r.namespace}.${r.key}.${r.locale}`, r.value]))
    expect(byPath.get('terms.title.es')).toBe('Título nuevo')
    expect(byPath.get('terms.title.en')).toBe('New title')
    expect(byPath.get('sellerAcquisition.anchor.heroTitle.es')).toBe('Vende ya')
  })

  test('jsonTreeToImportedRows returns [] for a non-object / malformed tree', () => {
    expect(jsonTreeToImportedRows(null)).toEqual([])
    expect(jsonTreeToImportedRows([1, 2])).toEqual([])
    expect(jsonTreeToImportedRows('x')).toEqual([])
  })
})

test.describe('diffImport', () => {
  const defaults = buildDefaultsMap(esDict, enDict)

  test('classifies unchanged, added, changed, and skippedUnknown correctly', () => {
    const currentOverrides: OverrideRow[] = [
      { namespace: 'terms', key: 'title', locale: 'es', value: 'Ya editado antes' },
    ]
    const imported = [
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'es', value: 'Vende lo que sea en México. 0% de comisión.' }, // unchanged (matches default, no override)
      { namespace: 'terms', key: 'title', locale: 'es', value: 'Ya editado antes' }, // unchanged (matches existing override)
      { namespace: 'terms', key: 'title', locale: 'en', value: 'Terms, revised' }, // added (bilingual, no prior override)
      { namespace: 'terms', key: 'doesNotExist', locale: 'es', value: 'x' }, // skippedUnknown
      { namespace: 'sellerAcquisition', key: 'anchor.heroTitle', locale: 'en', value: 'Sell anything' }, // skippedUnknown — es-only namespace
    ]
    const diff = diffImport(imported, currentOverrides, defaults)
    const byPath = new Map(diff.map((d) => [`${d.namespace}.${d.key}.${d.locale}`, d.action]))

    expect(byPath.get('sellerAcquisition.anchor.heroTitle.es')).toBe('unchanged')
    expect(byPath.get('terms.title.es')).toBe('unchanged')
    expect(byPath.get('terms.title.en')).toBe('added')
    expect(byPath.get('terms.doesNotExist.es')).toBe('skippedUnknown')
    expect(byPath.get('sellerAcquisition.anchor.heroTitle.en')).toBe('skippedUnknown')
  })

  test('a value differing from an EXISTING override is "changed", carrying the previous value', () => {
    const currentOverrides: OverrideRow[] = [
      { namespace: 'terms', key: 'title', locale: 'es', value: 'Primera edición' },
    ]
    const imported = [{ namespace: 'terms', key: 'title', locale: 'es', value: 'Segunda edición' }]
    const diff = diffImport(imported, currentOverrides, defaults)
    expect(diff[0]).toEqual({
      namespace: 'terms',
      key: 'title',
      locale: 'es',
      action: 'changed',
      previousValue: 'Primera edición',
      newValue: 'Segunda edición',
    })
  })

  test('skippedUnknown rows are never written by the caller — this module only classifies', () => {
    const diff = diffImport([{ namespace: 'nope', key: 'nope', locale: 'es', value: 'x' }], [], defaults)
    expect(diff).toEqual([{ namespace: 'nope', key: 'nope', locale: 'es', action: 'skippedUnknown', previousValue: null, newValue: 'x' }])
  })
})
