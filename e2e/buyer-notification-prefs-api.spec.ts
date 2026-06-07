import { test, expect } from '@playwright/test'

/**
 * Buyer Telegram channel + Buyer preference center · Sprint 1 — API guard.
 *
 * The buyer preference center is per-buyer data; its endpoint must reject
 * anonymous callers. The `api` project runs unauthenticated, so this asserts the
 * auth gate (401) on both verbs. The authed default-on read + persisted-toggle
 * round-trip, the forced-cell rejection, and audience isolation are covered by
 * the pure-logic resolver spec (offline) + the authed buyer browser smoke (owed
 * to Daniel) — stated in the PR.
 */

test.describe('buyer notification-preferences API · auth gate', () => {
  test('GET rejects anonymous with 401', async ({ request }) => {
    const res = await request.get('/api/account/notification-preferences')
    expect(res.status()).toBe(401)
  })

  test('PATCH rejects anonymous with 401', async ({ request }) => {
    const res = await request.patch('/api/account/notification-preferences', {
      data: { channel: 'email', event_group: 'buyer.envios', enabled: false },
    })
    expect(res.status()).toBe(401)
  })
})
