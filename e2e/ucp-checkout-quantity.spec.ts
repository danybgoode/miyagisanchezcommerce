import { test, expect } from '@playwright/test'

/**
 * Events: quantity selector · S1.3 — the UCP checkout-session accepts a
 * `quantity` (surface parity, AGENTS rule #3): it clamps to the kill-switch +
 * remaining seats and echoes `quantity` + `line_total` so an agent sees what a
 * buyer would be charged. NOTE: agent-initiated ticket *issuance* is deferred
 * (the agent checkout endpoints don't open a Medusa cart) — this proves the
 * surface, not end-to-end issuance.
 *
 * Fixture-gated: set MS_TEST_EVENT_LISTING_ID to a public, priced event listing.
 * The assertions are flag-AGNOSTIC invariants (true whether the kill-switch is on
 * or off), so the spec is stable across environments.
 */

const EVENT_LISTING_ID = process.env.MS_TEST_EVENT_LISTING_ID

test.describe('ucp checkout-session · quantity (fixture-gated)', () => {
  test('echoes a clamped quantity + a matching line_total', async ({ request }) => {
    test.skip(!EVENT_LISTING_ID, 'Set MS_TEST_EVENT_LISTING_ID (a public, priced event listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: EVENT_LISTING_ID, quantity: 2 },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    // quantity is always present, an integer ≥ 1, and never exceeds the request
    // (clamped down by the kill-switch when off, or by remaining seats).
    expect(typeof session.quantity).toBe('number')
    expect(Number.isInteger(session.quantity)).toBeTruthy()
    expect(session.quantity).toBeGreaterThanOrEqual(1)
    expect(session.quantity).toBeLessThanOrEqual(2)

    // line_total = unit price × quantity (the agent sees the real charge).
    if (session.price) {
      expect(session.line_total).toBeTruthy()
      expect(session.line_total.amount_cents).toBe(session.price.amount_cents * session.quantity)
    }
  })

  test('a non-positive quantity floors to 1', async ({ request }) => {
    test.skip(!EVENT_LISTING_ID, 'Set MS_TEST_EVENT_LISTING_ID (a public, priced event listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: EVENT_LISTING_ID, quantity: 0 },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()
    expect(session.quantity).toBe(1)
  })

  test('omitting quantity defaults to 1', async ({ request }) => {
    test.skip(!EVENT_LISTING_ID, 'Set MS_TEST_EVENT_LISTING_ID (a public, priced event listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: EVENT_LISTING_ID },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()
    expect(session.quantity).toBe(1)
    if (session.price) {
      expect(session.line_total.amount_cents).toBe(session.price.amount_cents)
    }
  })
})
