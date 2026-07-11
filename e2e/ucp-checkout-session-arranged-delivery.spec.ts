import { test, expect } from '@playwright/test'

/**
 * Arranged-only delivery epic · Sprint 2 · S2.1 — agent/UCP surface parity.
 *
 * Before this story, `POST /api/ucp/checkout-session` never sent the listing's
 * `delivery_mode` to the backend's `checkout-options` and ignored
 * `only_coordinated`/`delivery_methods` in the response entirely — an agent
 * checking out a coordinated listing (arranged product, or service/rental)
 * still saw MercadoPago/Stripe as available. This proves the fix: a
 * coordinated listing's session carries `delivery.arranged: true` + a
 * non-empty note, and NO instant checkout_url (mercadopago/stripe both
 * `available: false`).
 *
 * See `ucp-checkout-session-shipping-boundary.spec.ts` for the complementary
 * boundary — an ordinary SHIPPABLE listing carries no `delivery` field at all.
 *
 * Fixture-gated: set MS_TEST_ARRANGED_LISTING_ID to a public, priced listing
 * that is coordinated-delivery — either a service/rental listing (works
 * regardless of shipping.arranged_only_enabled, S2.2 made that unconditional)
 * or a plain product with delivery_mode=arranged AND the flag ON.
 */

const ARRANGED_LISTING_ID = process.env.MS_TEST_ARRANGED_LISTING_ID

test.describe('ucp checkout-session · arranged/coordinated delivery hint (fixture-gated)', () => {
  test('a coordinated listing carries delivery.arranged + note, no instant checkout_url', async ({ request }) => {
    test.skip(!ARRANGED_LISTING_ID, 'Set MS_TEST_ARRANGED_LISTING_ID (a coordinated-delivery listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: ARRANGED_LISTING_ID },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    expect(session.delivery).toBeTruthy()
    expect(session.delivery.arranged).toBe(true)
    expect(typeof session.delivery.note).toBe('string')
    expect(session.delivery.note.length).toBeGreaterThan(0)

    const mp = session.payment_options?.find((o: { method: string }) => o.method === 'mercadopago')
    const stripe = session.payment_options?.find((o: { method: string }) => o.method === 'stripe')
    expect(mp?.available).toBe(false)
    expect(mp?.checkout_url).toBeUndefined()
    expect(stripe?.available).toBe(false)
    expect(stripe?.checkout_url).toBeUndefined()
  })
})
