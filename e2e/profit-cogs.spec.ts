import { test, expect } from '@playwright/test'
import { validateRows, CATALOG_IMPORT_FIELDS } from '../lib/catalog-import'
import { parseCostPesosToCents, parsePesosToCents } from '../lib/opciones'

/**
 * Profit Analyzer · Sprint 1 · US-1 — COGS per variant (bulk CSV + editor parse).
 *
 * Pure blocks only (api project): the catalog importer's `unit_cost` column
 * (per-row errors, never a dead batch) and the cost-vs-price parse split —
 * a unit COST legitimately parses at $0 where a PRICE does not.
 */

const validRow = {
  external_id: 'SKU-1',
  title: 'Producto de prueba con costo',
  category: 'deportes',
  price: 100,
}

// ── unit_cost CSV column ────────────────────────────────────────────────────
test.describe('profit-cogs · catalog import unit_cost (US-1)', () => {
  test('unit_cost is a declared import field', () => {
    expect(CATALOG_IMPORT_FIELDS.some(f => f.name === 'unit_cost')).toBe(true)
  })

  test('a valid unit_cost coerces to a number on the staged row', () => {
    const [staged] = validateRows([{ ...validRow, unit_cost: 45.5 }])
    expect(staged.valid).toBe(true)
    expect(staged.row.unit_cost).toBe(45.5)
  })

  test('unit_cost 0 is valid (a cost can be zero, unlike a price)', () => {
    const [staged] = validateRows([{ ...validRow, unit_cost: 0 }])
    expect(staged.valid).toBe(true)
    expect(staged.row.unit_cost).toBe(0)
  })

  test('a negative unit_cost errors that row only — sibling rows import', () => {
    const staged = validateRows([
      { ...validRow, unit_cost: -5 },
      { ...validRow, external_id: 'SKU-2', title: 'Producto hermano sin costo' },
    ])
    expect(staged[0].valid).toBe(false)
    expect(staged[0].issues.some(i => i.field === 'unit_cost' && i.level === 'error')).toBe(true)
    expect(staged[1].valid).toBe(true)
  })

  test('a non-numeric unit_cost is a per-row error, not a crash', () => {
    const [staged] = validateRows([{ ...validRow, unit_cost: 'gratis' }])
    expect(staged.valid).toBe(false)
    expect(staged.issues.some(i => i.field === 'unit_cost')).toBe(true)
  })

  test('omitting unit_cost stays valid (the field is optional)', () => {
    const [staged] = validateRows([validRow])
    expect(staged.valid).toBe(true)
    expect(staged.row.unit_cost).toBeUndefined()
  })
})

// ── cost parse (editor inputs) ──────────────────────────────────────────────
test.describe('profit-cogs · parseCostPesosToCents (US-1)', () => {
  test('parses pesos to integer centavos', () => {
    expect(parseCostPesosToCents('45.50')).toBe(4550)
    expect(parseCostPesosToCents('1,500')).toBe(150000)
  })

  test('accepts $0 where the price parser rejects it', () => {
    expect(parseCostPesosToCents('0')).toBe(0)
    expect(parsePesosToCents('0')).toBeNull()
  })

  test('rejects negatives and garbage', () => {
    expect(parseCostPesosToCents('-1')).toBeNull()
    expect(parseCostPesosToCents('abc')).toBeNull()
    expect(parseCostPesosToCents('')).toBeNull()
  })
})
