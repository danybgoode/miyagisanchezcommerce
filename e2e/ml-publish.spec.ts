import { test, expect } from '@playwright/test'
import {
  pickCategory,
  mlPublishView,
  ML_CATEGORY_CONFIDENCE_THRESHOLD,
  type MlCategoryCandidate,
} from '../lib/ml-publish'

/**
 * Mercado Libre publish · Sprint 3 (epic 03 · mercadolibre-sync).
 *
 * The ML writes (create/update/close/relist) + payload build + token live in the
 * Medusa backend module and the seller-scoped routes (unreachable from the `api`
 * runner), so this gate covers what the frontend owns deterministically:
 *   - the category-predictor decision incl. low-confidence / override (US-9),
 *   - the linkage-derived publish view / button label (US-7/US-8), and
 *   - the publish/predict routes' auth shape (anonymous is rejected).
 * The real ML-sandbox publish+edit+close smoke is owed to Daniel. See sprint-3.md.
 */

function cand(category_id: string, score: number, category_name = ''): MlCategoryCandidate {
  return { category_id, category_name: category_name || category_id, score }
}

// ── US-9: category predictor decision ──────────────────────────────────────────
test.describe('ml-publish · pickCategory', () => {
  test('a seller override always wins (no choice needed)', () => {
    const c = pickCategory([cand('MLM111', 0.95)], { override: 'MLM999' })
    expect(c).toMatchObject({ categoryId: 'MLM999', source: 'override', needsChoice: false })
  })

  test('a high-confidence top prediction is used automatically', () => {
    const c = pickCategory([cand('MLM1', 0.9), cand('MLM2', 0.3)])
    expect(c.categoryId).toBe('MLM1')
    expect(c.source).toBe('predicted')
    expect(c.needsChoice).toBe(false)
  })

  test('picks the highest score regardless of input order', () => {
    const c = pickCategory([cand('low', 0.2), cand('high', 0.8), cand('mid', 0.5)])
    expect(c.categoryId).toBe('high')
  })

  test('low confidence surfaces a CHOICE rather than silently guessing', () => {
    const c = pickCategory([cand('MLM1', 0.3), cand('MLM2', 0.1)])
    expect(c.categoryId).toBeNull() // never auto-publishes a low-confidence guess
    expect(c.needsChoice).toBe(true)
    expect(c.suggestion).toBe('MLM1') // top candidate pre-fills the override, not auto
  })

  test('a low-confidence choice pre-fills the imported (Sprint-2) category when present', () => {
    const c = pickCategory([cand('MLM1', 0.2)], { importedMlCategoryId: 'MLM_IMPORTED' })
    expect(c.needsChoice).toBe(true)
    expect(c.suggestion).toBe('MLM_IMPORTED')
  })

  test('no candidates → must choose, no guess', () => {
    const c = pickCategory([])
    expect(c).toMatchObject({ categoryId: null, source: 'none', needsChoice: true, suggestion: null })
  })

  test('the threshold is the documented boundary (≥ passes)', () => {
    const at = pickCategory([cand('MLM1', ML_CATEGORY_CONFIDENCE_THRESHOLD)])
    expect(at.needsChoice).toBe(false)
    const below = pickCategory([cand('MLM1', ML_CATEGORY_CONFIDENCE_THRESHOLD - 0.01)])
    expect(below.needsChoice).toBe(true)
  })
})

// ── US-7/US-8: linkage-derived publish view ────────────────────────────────────
test.describe('ml-publish · mlPublishView', () => {
  test('not linked → publish label', () => {
    const v = mlPublishView(null)
    expect(v).toMatchObject({ linked: false, actionLabel: 'Publicar en Mercado Libre' })
  })

  test('linked + active → sync label', () => {
    const v = mlPublishView({ ml_item_id: 'MLM1', ml_status: 'active', permalink: 'https://x', ml_category_id: 'MLM2', last_synced_at: null })
    expect(v.linked).toBe(true)
    expect(v.permalink).toBe('https://x')
    expect(v.actionLabel).toBe('Sincronizar con Mercado Libre')
  })

  test('linked + closed → reopen label', () => {
    const v = mlPublishView({ ml_item_id: 'MLM1', ml_status: 'closed', permalink: null, ml_category_id: null, last_synced_at: null })
    expect(v.mlStatus).toBe('closed')
    expect(v.actionLabel).toBe('Reabrir en Mercado Libre')
  })
})

// ── US-7/US-9: publish + predict routes are auth-gated ──────────────────────────
test.describe('ml publish routes · anonymous is rejected', () => {
  test('POST /api/sell/ml/publish → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/ml/publish', { data: { productId: 'prod_x' } })
    expect(res.status()).toBe(401)
  })

  test('GET /api/sell/ml/predict → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/sell/ml/predict?q=taladro')
    expect(res.status()).toBe(401)
  })
})
