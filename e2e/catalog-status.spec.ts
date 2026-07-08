import { test, expect } from '@playwright/test'
import { deriveCatalogStatus, countByCatalogStatus, CATALOG_STATUS_FILTERS } from '../lib/catalog-status'

/**
 * Catalog status deriver — pure logic (api gate, no browser). Covers all four
 * first-class states plus the agotado-precedence rule (catalog-management
 * epic, Sprint 1 · Story 1.3) — this is the regression test for the
 * pausado/borrador gap: before the backend's `metadata.paused` fix, a paused
 * listing was indistinguishable from a never-published draft after a reload.
 */

test.describe('catalog-status · deriveCatalogStatus', () => {
  test('published + in stock (or unmanaged) → activo', () => {
    expect(deriveCatalogStatus({ status: 'active' })).toBe('activo')
    expect(deriveCatalogStatus({ status: 'active', manage_inventory: false })).toBe('activo')
    expect(deriveCatalogStatus({ status: 'active', manage_inventory: true, in_stock: true })).toBe('activo')
  })

  test('published + managed + sold out → agotado (takes precedence over activo)', () => {
    expect(deriveCatalogStatus({ status: 'active', manage_inventory: true, in_stock: false })).toBe('agotado')
  })

  test('draft (never published) → borrador', () => {
    expect(deriveCatalogStatus({ status: 'draft' })).toBe('borrador')
  })

  test('paused → pausado, distinct from borrador — the fixed gap', () => {
    expect(deriveCatalogStatus({ status: 'paused' })).toBe('pausado')
    expect(deriveCatalogStatus({ status: 'paused' })).not.toBe('borrador')
  })

  test('any other raw Medusa status (proposed/rejected) falls back to borrador', () => {
    expect(deriveCatalogStatus({ status: 'proposed' })).toBe('borrador')
    expect(deriveCatalogStatus({ status: 'rejected' })).toBe('borrador')
  })
})

test.describe('catalog-status · countByCatalogStatus', () => {
  test('tallies a mixed batch correctly', () => {
    const counts = countByCatalogStatus([
      { status: 'active' },
      { status: 'active', manage_inventory: true, in_stock: false },
      { status: 'draft' },
      { status: 'paused' },
      { status: 'paused' },
    ])
    expect(counts).toEqual({ activo: 1, agotado: 1, borrador: 1, pausado: 2 })
  })

  test('empty batch → all zeros', () => {
    expect(countByCatalogStatus([])).toEqual({ activo: 0, borrador: 0, pausado: 0, agotado: 0 })
  })
})

test.describe('catalog-status · CATALOG_STATUS_FILTERS', () => {
  test('exposes exactly the four first-class states', () => {
    expect(CATALOG_STATUS_FILTERS.map((f) => f.value)).toEqual(['activo', 'agotado', 'borrador', 'pausado'])
  })
})
