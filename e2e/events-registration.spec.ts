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

  test('secret-gated smoke proves idempotency and capacity closure', async ({ request }) => {
    const secret = process.env.EVENTS_TICKETING_SMOKE_SECRET
    test.skip(!secret, 'Set EVENTS_TICKETING_SMOKE_SECRET to run mutating event registration smoke.')

    const res = await request.post('/api/internal/events-ticketing/smoke', {
      headers: { 'x-events-ticketing-test-secret': secret! },
      data: { keep: false },
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json() as {
      first_registered: boolean
      duplicate_idempotent: boolean
      capacity_full: boolean
      registered_count: number
    }
    expect(data.first_registered).toBe(true)
    expect(data.duplicate_idempotent).toBe(true)
    expect(data.capacity_full).toBe(true)
    expect(data.registered_count).toBe(1)
  })
})
