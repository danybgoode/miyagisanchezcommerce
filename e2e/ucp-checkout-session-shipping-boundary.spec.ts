import { test, expect } from '@playwright/test'

/**
 * UCP buyer shipping exposure · Sprint 1.
 *
 * This used to assert the product gap: ordinary shippable listings exposed no
 * delivery concept at all. The epic intentionally reverses that boundary by
 * projecting Medusa checkout-options + Envía/Correos rates into the official
 * UCP fulfillment shape. Raw backend delivery/shipping siblings remain banned.
 *
 * Update (arranged-only-delivery epic, S2.1): a COORDINATED listing (arranged
 * product, or service/rental) now DOES carry a `delivery: { arranged, note }`
 * hint — see `ucp-checkout-session-arranged-delivery.spec.ts`. This spec's
 * arranged response stays a separate additive contract.
 *
 * Fixture-gated: set MS_TEST_SHIPPABLE_LISTING_ID to a public, priced,
 * physical (shippable) listing.
 */

const SHIPPABLE_LISTING_ID = process.env.MS_TEST_SHIPPABLE_LISTING_ID

const TEST_DESTINATION = {
  name: 'Comprador de prueba',
  phone: '5555555555',
  line1: 'Av. Insurgentes Sur',
  ext_number: '1234',
  line2: 'Del Valle',
  city: 'Benito Juárez',
  state: 'Ciudad de México',
  state_code: 'CX',
  postal_code: '03100',
  country: 'MX',
}

test.describe('ucp checkout-session · physical fulfillment (fixture-gated)', () => {
  test('a shippable listing names the missing destination instead of a confident empty result', async ({ request }) => {
    test.skip(!SHIPPABLE_LISTING_ID, 'Set MS_TEST_SHIPPABLE_LISTING_ID (a public, priced, physical listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: SHIPPABLE_LISTING_ID },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    expect(session.fulfillment).toBeTruthy()
    expect(session.fulfillment.shipping_quote_state).toBe('destination_required')
    expect(session.fulfillment.methods.some((method: { type?: string }) => method.type === 'shipping')).toBe(true)

    // UCP is the deliberate public shape; never leak a raw backend sibling.
    expect(session).not.toHaveProperty('shipping')
    expect(session).not.toHaveProperty('delivery')
    expect(session).not.toHaveProperty('delivery_methods')
    expect(session).not.toHaveProperty('shipping_methods')
    expect(session).not.toHaveProperty('shipping_options')

    // payment_options still works as documented (the surface that DOES exist).
    expect(Array.isArray(session.payment_options)).toBeTruthy()
  })

  test('a complete destination returns ordered selectable options with centavo totals', async ({ request }) => {
    test.skip(!SHIPPABLE_LISTING_ID, 'Set MS_TEST_SHIPPABLE_LISTING_ID (a public, priced, physical listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: SHIPPABLE_LISTING_ID, shipping_destination: TEST_DESTINATION },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()
    expect(session.fulfillment.shipping_quote_state).toBe('options_present')

    const shipping = session.fulfillment.methods.find((method: { type?: string }) => method.type === 'shipping')
    expect(shipping.destinations).toHaveLength(1)
    expect(shipping.selected_destination_id).toBe(shipping.destinations[0].id)
    expect(shipping.groups).toHaveLength(1)
    expect(shipping.groups[0].options.length).toBeGreaterThan(0)
    for (const option of shipping.groups[0].options) {
      expect(option.id).toMatch(/^shipping_[a-f0-9]{24}$/)
      expect(option.title.length).toBeGreaterThan(0)
      expect(option.totals).toEqual([
        expect.objectContaining({ type: 'fulfillment', amount: expect.any(Number) }),
      ])
      expect(option.totals[0].amount).toBeGreaterThan(0)
    }
  })
})
