import { test, expect } from '@playwright/test'

/**
 * Embeddable Widget · Sprint 1 (US-1) — per-shop embed key.
 * Guards the public resolver's "recognized vs anonymous" behaviour and the
 * Clerk gate on the seller mint route. All read-only.
 *
 * The valid-key happy path needs a seeded shop + minted key (the mint route is
 * Clerk-gated), so it's covered by live confirmation, not here.
 */
test.describe('Embed key — public resolver', () => {
  test('OPTIONS preflight is CORS-open', async ({ request }) => {
    const res = await request.fetch('/api/embed/shop', { method: 'OPTIONS' })
    expect(res.status()).toBe(204)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })

  test('no key → 404 not-recognized (treated as anonymous)', async ({ request }) => {
    const res = await request.get('/api/embed/shop')
    expect(res.status()).toBe(404)
    expect((await res.json()).valid).toBe(false)
    // CORS headers present even on the negative path (browser would block otherwise).
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })

  test('malformed / unknown key → 404 not-recognized', async ({ request }) => {
    const malformed = await request.get('/api/embed/shop?key=not-a-key')
    expect(malformed.status()).toBe(404)
    // Well-formed but unknown key (never minted) — also unrecognized.
    const unknown = await request.get('/api/embed/shop?key=emb_pk_00000000000000000000000000000000')
    expect(unknown.status()).toBe(404)
    expect((await unknown.json()).valid).toBe(false)
  })
})

test.describe('Embed key — seller mint route is Clerk-gated', () => {
  test('GET without auth → 401', async ({ request }) => {
    const res = await request.get('/api/sell/embed-key')
    expect(res.status()).toBe(401)
  })
})
