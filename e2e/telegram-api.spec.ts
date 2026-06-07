import { test, expect } from '@playwright/test'

/**
 * Granular Multi-Channel Notifications · Sprint 2 — API guards.
 *
 * The link control endpoints are per-seller data (Clerk-gated → 401 anonymous),
 * and the inbound webhook is a new public surface that MUST reject any call that
 * doesn't carry the shared secret token (→ 403). The `api` project runs
 * unauthenticated and without the secret, so it asserts exactly those boundaries.
 *
 * The full happy path (valid secret + valid token → telegram_links row written,
 * "¡Conectado!" reply) needs the real bot secret + a real Telegram chat → owed
 * to Daniel (stated in the PR + sprint smoke walkthrough).
 */

test.describe('telegram link API · auth gate', () => {
  test('GET rejects anonymous with 401', async ({ request }) => {
    const res = await request.get('/api/sell/telegram/link')
    expect(res.status()).toBe(401)
  })

  test('POST rejects anonymous with 401', async ({ request }) => {
    const res = await request.post('/api/sell/telegram/link')
    expect(res.status()).toBe(401)
  })

  test('DELETE rejects anonymous with 401', async ({ request }) => {
    const res = await request.delete('/api/sell/telegram/link')
    expect(res.status()).toBe(401)
  })

  test('test-message POST rejects anonymous with 401', async ({ request }) => {
    const res = await request.post('/api/sell/telegram/test')
    expect(res.status()).toBe(401)
  })
})

test.describe('telegram webhook · secret-token gate', () => {
  test('rejects a call with no secret-token header (403)', async ({ request }) => {
    const res = await request.post('/api/telegram/webhook', {
      data: { message: { text: '/start abc', chat: { id: 1 } } },
    })
    expect(res.status()).toBe(403)
  })

  test('rejects a call with a wrong secret-token header (403)', async ({ request }) => {
    const res = await request.post('/api/telegram/webhook', {
      headers: { 'x-telegram-bot-api-secret-token': 'definitely-not-the-secret' },
      data: { message: { text: '/start abc', chat: { id: 1 } } },
    })
    expect(res.status()).toBe(403)
  })
})
