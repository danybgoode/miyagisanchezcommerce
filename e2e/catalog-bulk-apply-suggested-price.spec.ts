import { test, expect } from '@playwright/test'

/**
 * Catalog bulk "apply suggested price" — catalog-management epic, Sprint 4 ·
 * Story 4.2. Same convention as `catalog-bulk.spec.ts`: the three bulk
 * routes are Clerk-auth-gated regardless of flag state, and that's the one
 * thing deterministically testable without a real seller session + real
 * ledger data + `ops.profit_enabled`/`catalog.bulk_enabled` both ON. The
 * pure eligibility logic (resolveSuggestedPriceCandidate, multi-variant
 * rejection) is already covered in `e2e/catalog-margin.spec.ts` and the
 * backend's `catalog-bulk.unit.spec.ts` — this file only re-confirms the
 * auth gate holds for a body shaped like this new action type specifically
 * (a malformed/adversarial payload must never bypass auth).
 *
 * The full money-path round trip (stage a real suggested price on a real
 * product with sales history + COGS, confirm the total, apply, verify Miyagi
 * PDP + the ML-linked listing both update) is owed to Daniel per the
 * sprint-4.md smoke walkthrough — needs a real seller session, real order
 * history, and both flags ON, none of which this API-level project can
 * provide.
 */

const SUGGESTED_PRICE_ACTION = {
  type: 'apply_suggested_price',
  target_margin_pct: 0.25,
  items: [{ id: 'prod_fake', price_cents: 12000 }],
}

test.describe('catalog bulk actions — apply_suggested_price auth gate (always on)', () => {
  test('POST /api/sell/catalog/bulk with an apply_suggested_price action still requires auth', async ({ request }) => {
    const res = await request.post('/api/sell/catalog/bulk', {
      data: { ids: ['prod_fake'], action: SUGGESTED_PRICE_ACTION },
    })
    expect(res.status()).toBe(401)
  })

  test('GET /api/sell/catalog/bulk/[batchId] requires auth regardless of what was staged', async ({ request }) => {
    const res = await request.get('/api/sell/catalog/bulk/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(401)
  })

  test('POST /api/sell/catalog/bulk/[batchId]/apply requires auth regardless of the staged action type', async ({ request }) => {
    const res = await request.post('/api/sell/catalog/bulk/00000000-0000-0000-0000-000000000000/apply')
    expect(res.status()).toBe(401)
  })
})
