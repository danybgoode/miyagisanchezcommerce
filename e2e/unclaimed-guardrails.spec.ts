import { test, expect } from '@playwright/test'
import { isShopClaimed } from '../lib/claim'

/**
 * Seller & unclaimed-shop bug sweep · Sprint 1 — money-path guardrails for
 * unclaimed (gem-imported) shops.
 *
 * The always-on lock is the pure `isShopClaimed` predicate: the PDP gate
 * (`app/l/[id]/page.tsx`), the offers route, and `checkout-session` all consume
 * this one function, so locking it here locks every seam (extract the seam, test
 * the seam). The route-level checks below light up when `MS_TEST_UNCLAIMED_LISTING_ID`
 * is set (a PUBLIC listing on a "Sin reclamar" shop) and skip cleanly otherwise.
 *
 * The authed buyer → unclaimed-offer 409 + "no oferta-enviada email" is owed to
 * Daniel (the offers POST is Clerk-gated; the api project runs unauthenticated, so
 * it can only assert the auth gate stays intact) — stated in the PR + sprint smoke.
 */

const UNCLAIMED_LISTING_ID = process.env.MS_TEST_UNCLAIMED_LISTING_ID

test.describe('unclaimed guardrails · isShopClaimed (pure — always on)', () => {
  test('a real owner (non-pending clerk_user_id) is claimed', () => {
    expect(isShopClaimed({ clerk_user_id: 'user_2abc' })).toBe(true)
  })

  test('a gem shop with no owner (null / undefined) is NOT claimed', () => {
    expect(isShopClaimed({ clerk_user_id: null })).toBe(false)
    expect(isShopClaimed({ clerk_user_id: undefined })).toBe(false)
    expect(isShopClaimed({})).toBe(false)
    expect(isShopClaimed(null)).toBe(false)
    expect(isShopClaimed(undefined)).toBe(false)
  })

  test('the legacy `pending:` placeholder is NOT claimed', () => {
    expect(isShopClaimed({ clerk_user_id: 'pending:abc123' })).toBe(false)
    expect(isShopClaimed({ clerk_user_id: '' })).toBe(false)
  })
})

test.describe('unclaimed guardrails · offers route (always on)', () => {
  test('POST /api/offers rejects anonymous with 401 — the claim gate never turns a clean auth reject into a 500', async ({ request }) => {
    const res = await request.post('/api/offers', {
      data: { listingId: 'prod_does_not_matter', offerAmountCents: 1000 },
    })
    expect([401, 429]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })
})

test.describe('unclaimed guardrails · checkout-session (fixture-gated)', () => {
  test('an unclaimed listing offers NO claim-dependent payable method + carries reason_unavailable', async ({ request }) => {
    test.skip(!UNCLAIMED_LISTING_ID, 'Set MS_TEST_UNCLAIMED_LISTING_ID (a public listing on a "Sin reclamar" shop) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: UNCLAIMED_LISTING_ID },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    const byMethod = Object.fromEntries(
      (session.payment_options ?? []).map((o: { method: string }) => [o.method, o]),
    ) as Record<string, { available: boolean; reason_unavailable?: string }>

    // The claim-gated payable methods must all be unavailable for an unclaimed shop.
    for (const method of ['mercadopago', 'stripe', 'cash_on_pickup', 'whatsapp']) {
      expect(byMethod[method]?.available, `${method} must be unavailable on an unclaimed shop`).toBeFalsy()
    }
    // The agent gets a human reason on the card-rail option.
    expect(byMethod.mercadopago?.reason_unavailable).toContain('vendedor registrado')
  })
})
