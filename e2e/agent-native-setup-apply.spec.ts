import { test, expect } from '@playwright/test'
import {
  planSetupApply,
  aggregateSetupReport,
  chunkFailureRows,
  IMPORT_CHUNK_SIZE,
  type RowResult,
} from '../lib/setup-apply'
import { MAX_IMPORT_ROWS, validateRows, type CatalogImportRow } from '../lib/catalog-import'
import { EXAMPLE_SETUP } from '../lib/setup-spec'

/**
 * Agent-native setup (Onboarding 0) · Sprint 2 — first-run apply orchestration.
 *
 * Pure-logic coverage of the seam both the client orchestrator and this runner
 * import: the plan (create-shop-if-missing payload + chunking + cap) and the
 * fold of the three call results into one per-block / per-row report (partial
 * failure + idempotent re-apply). No auth, no network, no mutations.
 */

function makeRows(n: number): CatalogImportRow[] {
  return Array.from({ length: n }, (_, i) => ({
    external_id: `SKU-${i + 1}`,
    title: `Producto ${i + 1}`,
    category: 'otros' as CatalogImportRow['category'],
  }))
}

// ── planSetupApply (pure) ─────────────────────────────────────────────────────
test.describe('setup-apply · planSetupApply (2.1)', () => {
  test('chunks the catalog into ≤25-row batches', () => {
    const plan = planSetupApply({ miyagi_setup_version: '1', catalog: makeRows(60) })
    expect(plan.catalogChunks.map((c) => c.length)).toEqual([25, 25, 10])
    expect(IMPORT_CHUNK_SIZE).toBe(25)
  })

  test('caps the catalog at MAX_IMPORT_ROWS', () => {
    const plan = planSetupApply({ miyagi_setup_version: '1', catalog: makeRows(MAX_IMPORT_ROWS + 50) })
    const total = plan.catalogChunks.reduce((s, c) => s + c.length, 0)
    expect(total).toBe(MAX_IMPORT_ROWS)
  })

  test('derives the shop payload from profile', () => {
    const plan = planSetupApply({
      miyagi_setup_version: '1',
      profile: { name: '  Refacciones del Norte  ', state: 'Nuevo León', city: 'Monterrey' },
    })
    expect(plan.shop.name).toBe('Refacciones del Norte')
    expect(plan.shop.state).toBe('Nuevo León')
    expect(plan.shop.city).toBe('Monterrey')
  })

  test('falls back to the config profile when top-level profile is absent', () => {
    const plan = planSetupApply({
      miyagi_setup_version: '1',
      config: { profile: { name: 'Desde config' } },
    })
    expect(plan.shop.name).toBe('Desde config')
    expect(plan.configManifest).not.toBeNull()
  })

  test('configManifest is null when no config block is present', () => {
    const plan = planSetupApply({ miyagi_setup_version: '1', catalog: makeRows(2) })
    expect(plan.configManifest).toBeNull()
  })

  test('the S1 example file plans cleanly', () => {
    const plan = planSetupApply(EXAMPLE_SETUP)
    expect(plan.shop.name).toBe(EXAMPLE_SETUP.profile!.name)
    expect(plan.configManifest).not.toBeNull()
    expect(plan.catalogChunks.flat().length).toBe(EXAMPLE_SETUP.catalog!.length)
  })
})

// ── aggregateSetupReport (pure) ───────────────────────────────────────────────
test.describe('setup-apply · aggregateSetupReport (2.1)', () => {
  const rows = (specs: Array<RowResult['status']>): RowResult[] =>
    specs.map((status, i) => ({ line: i + 1, title: `P${i + 1}`, status }))

  test('sums created / updated / failed across chunks', () => {
    const report = aggregateSetupReport({
      shop: { ok: true, status: 201, shopSlug: 'mi-tienda' },
      config: { ok: true, blocks: [{ key: 'profile', label: 'Perfil', status: 'applied', appliedFields: ['name'], issues: [] }] },
      catalogChunks: [
        { results: rows(['created', 'created', 'failed']) },
        { results: rows(['updated', 'created']) },
      ],
    })
    expect(report.shop).toBe('created')
    expect(report.shopSlug).toBe('mi-tienda')
    expect(report.config).toHaveLength(1)
    expect(report.catalog).toMatchObject({ created: 3, updated: 1, failed: 1 })
    expect(report.catalog.rows).toHaveLength(5)
  })

  test('shop 200 → existed (idempotent re-apply: all updated, zero created)', () => {
    const report = aggregateSetupReport({
      shop: { ok: true, status: 200, shopSlug: 'mi-tienda' },
      config: { ok: true, blocks: [] },
      catalogChunks: [{ results: rows(['updated', 'updated', 'updated']) }],
    })
    expect(report.shop).toBe('existed')
    expect(report.catalog).toMatchObject({ created: 0, updated: 3, failed: 0 })
  })

  test('shop error → failed; a missing config does not crash', () => {
    const report = aggregateSetupReport({
      shop: { ok: false, status: 500 },
      config: null,
      catalogChunks: [],
    })
    expect(report.shop).toBe('failed')
    expect(report.shopSlug).toBeNull()
    expect(report.config).toEqual([])
    expect(report.catalog).toMatchObject({ created: 0, updated: 0, failed: 0 })
  })

  test('a chunk with no results array is ignored (counts stay honest via chunkFailureRows)', () => {
    const staged = makeRows(3)
    const report = aggregateSetupReport({
      shop: { ok: true, status: 201, shopSlug: 's' },
      config: null,
      catalogChunks: [
        { results: chunkFailureRows(staged, 1, 'Error 404 al crear.') },
        {}, // a truly empty response contributes nothing
      ],
    })
    expect(report.catalog.failed).toBe(3)
    expect(report.catalog.rows.every((r) => r.status === 'failed')).toBe(true)
  })
})

// ── S4 inline-fix re-validation (Sprint 2 · Story 2.1) ─────────────────────
// SetupClient.tsx's staging preview patches a local row array and calls
// validateRows() again on every edit (same pure function ImportClient.tsx
// already uses) — this is the exact contract that flips a row's badge from
// "Corregir" to "Listo" without ever touching planSetupApply/the apply engine.
test.describe('setup-apply · S4 inline-fix re-validation (2.1)', () => {
  test('a row missing price/category starts invalid, then flips valid once patched', () => {
    const rows: CatalogImportRow[] = [{ title: 'Maceta de barro', category: '' as CatalogImportRow['category'] }]
    const before = validateRows(rows)
    expect(before[0].valid).toBe(false)
    expect(before[0].issues.some((i) => i.field === 'category')).toBe(true)

    const patched = [{ ...rows[0], category: 'hogar' as CatalogImportRow['category'] }]
    const after = validateRows(patched)
    expect(after[0].valid).toBe(true)
  })

  test('an edited row still flows into planSetupApply unchanged (the apply engine itself never sees the edit logic)', () => {
    const original = makeRows(1)
    const patched = [{ ...original[0], title: 'Título corregido' }]
    const plan = planSetupApply({ miyagi_setup_version: '1', catalog: patched })
    expect(plan.catalogChunks[0][0].title).toBe('Título corregido')
  })
})
