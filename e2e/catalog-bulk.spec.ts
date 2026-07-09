import { test, expect } from '@playwright/test'

/**
 * Catalog bulk actions — api gate (catalog-management epic, Sprint 3 · Story
 * 3.1). The three new routes are Clerk-auth-gated and, once authed, further
 * gated behind `catalog.bulk_enabled` (OFF in prod) — a full stage → preview
 * → apply round trip needs a real seller session + a disposable test listing
 * + the flag ON, none of which the `api` project (no browser, no Clerk login)
 * can provide. What IS deterministically testable without credentials is the
 * auth gate itself: every route must reject an anonymous caller before doing
 * anything else, regardless of the flag's state. The full round trip (bulk
 * price change on 50+ products incl. one deliberately invalid row, refresh-
 * mid-preview persistence, idempotent re-apply) is owed to Daniel per the
 * sprint-3.md smoke walkthrough — flag flip + real seller session required.
 */

test.describe('catalog bulk actions — auth gate (always on)', () => {
  test('POST /api/sell/catalog/bulk requires auth', async ({ request }) => {
    const res = await request.post('/api/sell/catalog/bulk', {
      data: { ids: ['prod_fake'], action: { type: 'price_pct', percent: 10 } },
    })
    expect(res.status()).toBe(401)
  })

  test('GET /api/sell/catalog/bulk/[batchId] requires auth', async ({ request }) => {
    const res = await request.get('/api/sell/catalog/bulk/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(401)
  })

  test('POST /api/sell/catalog/bulk/[batchId]/apply requires auth', async ({ request }) => {
    const res = await request.post('/api/sell/catalog/bulk/00000000-0000-0000-0000-000000000000/apply')
    expect(res.status()).toBe(401)
  })
})
