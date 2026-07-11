import { test, expect } from '@playwright/test'

/**
 * Shipping-provider-expansion · Sprint 3, Story 3.5 (narrowed — see the
 * `ucp-buyer-shipping-exposure` seed for the deferred full scope).
 *
 * `POST /api/ucp/checkout-session` does NOT expose shipping/delivery methods
 * to buyer-side agents today — not just for Correos, for anything (Envía
 * included; confirmed by reading the route, which only ever extracts
 * `payment_methods` from the backend checkout-options response). This spec
 * documents that real boundary rather than silently assuming "backend
 * checkout-options is the SSOT" means agents already inherit shipping
 * choices — they don't yet. The assertion is flag-AGNOSTIC (true whether
 * `shipping.correos_enabled` is on or off), so it's stable across
 * environments and doubles as a regression guard: if a future change
 * accidentally starts leaking a raw `delivery_methods`/`shipping` field
 * without the deliberate design pass a real UCP shipping surface deserves,
 * this catches it.
 *
 * Update (arranged-only-delivery epic, S2.1): a COORDINATED listing (arranged
 * product, or service/rental) now DOES carry a `delivery: { arranged, note }`
 * hint — see `ucp-checkout-session-arranged-delivery.spec.ts`. This spec's
 * boundary narrows to: an ordinary SHIPPABLE listing still carries none of
 * these fields; `delivery` is additive/conditional, never a blanket leak.
 *
 * Fixture-gated: set MS_TEST_SHIPPABLE_LISTING_ID to a public, priced,
 * physical (shippable) listing.
 */

const SHIPPABLE_LISTING_ID = process.env.MS_TEST_SHIPPABLE_LISTING_ID

test.describe('ucp checkout-session · no shipping/delivery exposure yet (fixture-gated)', () => {
  test('a shippable listing\'s session carries no shipping/delivery field', async ({ request }) => {
    test.skip(!SHIPPABLE_LISTING_ID, 'Set MS_TEST_SHIPPABLE_LISTING_ID (a public, priced, physical listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: SHIPPABLE_LISTING_ID },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    // Today's real boundary — no shipping/delivery concept reaches agents,
    // regardless of shipping.correos_enabled or shipping.envia_enabled.
    expect(session).not.toHaveProperty('shipping')
    expect(session).not.toHaveProperty('delivery')
    expect(session).not.toHaveProperty('delivery_methods')
    expect(session).not.toHaveProperty('shipping_methods')
    expect(session).not.toHaveProperty('shipping_options')

    // payment_options still works as documented (the surface that DOES exist).
    expect(Array.isArray(session.payment_options)).toBeTruthy()
  })
})
