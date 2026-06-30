import { test, expect } from '@playwright/test'
import {
  mlItemToIncomingSupplyItem,
  mlCategoryToMiyagi,
  mlConditionToMiyagi,
  type MlImportItem,
} from '../lib/ml-import'
import { isDuplicateLink } from '../lib/ml-health'

/**
 * Mercado Libre import · Sprint 2 (epic 03 · mercadolibre-sync).
 *
 * The actual fetch + product create + linkage live in the Medusa backend module
 * and the seller-scoped routes (writes, unreachable from the `api` runner), so
 * this gate covers what the frontend owns deterministically:
 *   - the pure ML→supply field/category/condition mapping incl. graceful
 *     degradation (US-5) and the price-branch correctness for high-value items,
 *   - the linkage-aware dedupe predicate (US-6), and
 *   - the seller import routes' auth shape (anonymous is rejected).
 * The real ML-sandbox import smoke (render + dedupe re-run) is owed to Daniel.
 * See sprint-2.md.
 */

function makeItem(overrides: Partial<MlImportItem> = {}): MlImportItem {
  return {
    id: 'MLM123',
    title: 'Taladro inalámbrico 20V',
    category_id: 'MLM1499',
    price: 1850,
    currency_id: 'MXN',
    available_quantity: 4,
    condition: 'new',
    permalink: 'https://articulo.mercadolibre.com.mx/MLM-123',
    description: 'Taladro con dos baterías y maletín.',
    pictures: [{ url: 'https://http2.mlstatic.com/a.jpg' }, { url: 'https://http2.mlstatic.com/b.jpg' }],
    attributes: [{ id: 'BRAND', name: 'Marca', value_name: 'DeWalt' }],
    already_linked: false,
    ...overrides,
  }
}

// ── US-5: ML → supply field mapping ────────────────────────────────────────────
test.describe('ml-import · mlItemToIncomingSupplyItem', () => {
  test('maps a full item into the supply shape', () => {
    const out = mlItemToIncomingSupplyItem(makeItem())
    expect(out.source_id).toBe('MLM123')
    expect(out.source_url).toBe('https://articulo.mercadolibre.com.mx/MLM-123')
    expect(out.listing_title).toBe('Taladro inalámbrico 20V')
    expect(out.listing_description).toBe('Taladro con dos baterías y maletín.')
    expect(out.currency).toBe('MXN')
    expect(out.listing_type).toBe('product')
    expect(out.category).toBe('herramientas') // MLM1499 → herramientas
    expect(out.condition).toBe('new')
    expect(out.images).toEqual([
      { url: 'https://http2.mlstatic.com/a.jpg' },
      { url: 'https://http2.mlstatic.com/b.jpg' },
    ])
    // ml provenance is preserved for the later predictor (US-9) + linkage.
    expect(out.metadata).toMatchObject({ ml_item_id: 'MLM123', ml_category_id: 'MLM1499' })
  })

  test('routes price through the heuristic-correct branch', () => {
    // pesos ≤ 1M → `price` (×100 by normalizePriceCents downstream)
    const low = mlItemToIncomingSupplyItem(makeItem({ price: 1850 }))
    expect(low.price).toBe(1850)
    expect(low.price_cents).toBeUndefined()
    // pesos > 1M (a property) → `price_cents` so the >1M heuristic keeps it as-is
    const high = mlItemToIncomingSupplyItem(makeItem({ price: 2_500_000, category_id: 'MLM1459' }))
    expect(high.price_cents).toBe(250_000_000)
    expect(high.price).toBeUndefined()
    expect(high.category).toBe('inmuebles')
  })

  test('degrades missing/odd fields gracefully (no throw, no broken product)', () => {
    const out = mlItemToIncomingSupplyItem({
      id: 'MLM9',
      title: '',
      category_id: null,
      price: null,
      currency_id: null,
      available_quantity: null,
      condition: 'not_specified',
      permalink: null,
      description: '',
      pictures: [],
      attributes: [],
      already_linked: false,
    })
    expect(out.source_id).toBe('MLM9')
    expect(out.listing_title).toBeUndefined()
    expect(out.price).toBeUndefined()
    expect(out.price_cents).toBeUndefined()
    expect(out.images).toEqual([])
    expect(out.category).toBe('otros') // unknown category → fallback
    expect(out.condition).toBeUndefined() // unknown condition → unset
    expect(out.currency).toBe('MXN') // currency default
  })
})

// ── US-5: category + condition maps ────────────────────────────────────────────
test.describe('ml-import · mlCategoryToMiyagi', () => {
  test('maps known top-level ML categories', () => {
    expect(mlCategoryToMiyagi('MLM1743')).toBe('autos')
    expect(mlCategoryToMiyagi('MLM1459')).toBe('inmuebles')
    expect(mlCategoryToMiyagi('MLM1051')).toBe('electronica')
    expect(mlCategoryToMiyagi('MLM1430')).toBe('moda')
  })
  test('falls back to "otros" for an unknown/empty category', () => {
    expect(mlCategoryToMiyagi('MLM999999')).toBe('otros') // a leaf id → fallback (predictor is US-9)
    expect(mlCategoryToMiyagi(null)).toBe('otros')
    expect(mlCategoryToMiyagi(undefined)).toBe('otros')
  })
})

test.describe('ml-import · mlConditionToMiyagi', () => {
  test('maps new/used and leaves unknown unset', () => {
    expect(mlConditionToMiyagi('new')).toBe('new')
    expect(mlConditionToMiyagi('used')).toBe('good')
    expect(mlConditionToMiyagi('not_specified')).toBeUndefined()
    expect(mlConditionToMiyagi(null)).toBeUndefined()
  })
})

// ── US-6: linkage-aware dedupe predicate ───────────────────────────────────────
test.describe('ml-import · dedupe (1:1 linkage)', () => {
  const existing = [{ product_id: 'prod_1', ml_item_id: 'MLM1' }]
  test('an already-linked ML item is a duplicate; a fresh one is not', () => {
    expect(isDuplicateLink(existing, { product_id: 'prod_x', ml_item_id: 'MLM1' })).toBe(true)
    expect(isDuplicateLink(existing, { product_id: 'prod_x', ml_item_id: 'MLM2' })).toBe(false)
  })
})

// ── US-4/US-6: seller import routes are auth-gated ──────────────────────────────
test.describe('ml import routes · anonymous is rejected', () => {
  test('POST /api/sell/ml/import/fetch → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/ml/import/fetch')
    expect(res.status()).toBe(401)
  })

  test('POST /api/sell/ml/import → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/ml/import', { data: { batchId: 'x' } })
    expect(res.status()).toBe(401)
  })
})
