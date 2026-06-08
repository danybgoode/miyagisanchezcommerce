import { test, expect } from '@playwright/test'

/**
 * Buyer Telegram channel · Sprint 2 — API guard. The buyer Telegram link/test
 * endpoints are per-buyer; they must reject anonymous callers. The `api` project
 * runs unauthenticated, so this asserts the auth gate (401) on every verb. The
 * authed token→chat binding, the already-linked reuse, the dual-audience unlink
 * row-safety, and a delivered Telegram message are owed to Daniel (need a real
 * Telegram account); the pure unlink decision is covered offline by
 * audienceTelegramInUse in buyer-notification-prefs.spec.ts.
 */

test.describe('buyer telegram API · auth gate', () => {
  test('GET link status rejects anonymous with 401', async ({ request }) => {
    const res = await request.get('/api/account/telegram/link')
    expect(res.status()).toBe(401)
  })

  test('POST link (mint token) rejects anonymous with 401', async ({ request }) => {
    const res = await request.post('/api/account/telegram/link')
    expect(res.status()).toBe(401)
  })

  test('DELETE link (unlink) rejects anonymous with 401', async ({ request }) => {
    const res = await request.delete('/api/account/telegram/link')
    expect(res.status()).toBe(401)
  })

  test('POST test rejects anonymous with 401', async ({ request }) => {
    const res = await request.post('/api/account/telegram/test')
    expect(res.status()).toBe(401)
  })
})
