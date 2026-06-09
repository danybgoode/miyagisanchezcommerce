import { expect, test } from '@playwright/test'

test.describe('events and ticketing · email-code registration', () => {
  test('public registration APIs reject an unknown event', async ({ request }) => {
    const suffix = Date.now()
    const verification = await request.post(`/api/events/not-an-event-${suffix}/verification`, {
      data: { email: 'test@example.com', locale: 'es' },
    })
    expect(verification.status()).toBe(404)

    const registration = await request.post(`/api/events/not-an-event-${suffix}/registrations`, {
      data: { name: 'Test', email: 'test@example.com', code: 'ABC123', locale: 'es' },
    })
    expect(registration.status()).toBe(404)
  })

  test('secret-gated smoke proves idempotency, tickets, and redemption', async ({ request }) => {
    const secret = process.env.EVENTS_TICKETING_SMOKE_SECRET
    test.skip(!secret, 'Set EVENTS_TICKETING_SMOKE_SECRET to run mutating event registration smoke.')

    const res = await request.post('/api/internal/events-ticketing/smoke', {
      headers: { 'x-events-ticketing-test-secret': secret! },
      data: { keep: false },
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json() as {
      free_ticket_token: string | null
      free_ticket_qr_payload_is_token: boolean
      first_registered: boolean
      duplicate_idempotent: boolean
      capacity_full: boolean
      redeem_valid: boolean
      redeem_again_rejected: boolean
      redeem_forged_rejected: boolean
      redeem_wrong_seller_rejected: boolean
      registered_count: number
    }
    expect(data.free_ticket_token).toMatch(/^tkt_[a-f0-9]{32,}$/)
    expect(data.free_ticket_qr_payload_is_token).toBe(true)
    expect(data.first_registered).toBe(true)
    expect(data.duplicate_idempotent).toBe(true)
    expect(data.capacity_full).toBe(true)
    expect(data.redeem_valid).toBe(true)
    expect(data.redeem_again_rejected).toBe(true)
    expect(data.redeem_forged_rejected).toBe(true)
    expect(data.redeem_wrong_seller_rejected).toBe(true)
    expect(data.registered_count).toBe(1)
  })
})
