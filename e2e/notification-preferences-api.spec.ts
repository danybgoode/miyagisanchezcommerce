import { test, expect } from '@playwright/test'

/**
 * Granular Multi-Channel Notifications · Sprint 1 — API guard.
 *
 * The preference center is per-seller data; its endpoint must reject anonymous
 * callers. The `api` project runs unauthenticated, so this asserts the auth gate
 * (401). The authed default-on read + persisted-toggle round-trip is covered by
 * the pure-logic resolver spec (offline) + the authed seller browser smoke
 * (owed to Daniel) — stated in the PR.
 */

test.describe('notification-preferences API · auth gate', () => {
  test('GET rejects anonymous with 401', async ({ request }) => {
    const res = await request.get('/api/sell/notification-preferences')
    expect(res.status()).toBe(401)
  })

  test('PATCH rejects anonymous with 401', async ({ request }) => {
    const res = await request.patch('/api/sell/notification-preferences', {
      data: { channel: 'email', event_group: 'offers', enabled: false },
    })
    expect(res.status()).toBe(401)
  })
})
