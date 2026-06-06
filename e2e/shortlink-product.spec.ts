import { test, expect } from '@playwright/test'

/**
 * Product short links · US-4. The custom-slug availability endpoint is seller-only;
 * guard that it rejects anonymous callers (the namespace/validation logic is unit-
 * tested via lib/slug + lib/shortlink). Read-only.
 */
test.describe('product short link — availability endpoint', () => {
  test('rejects anonymous callers (401)', async ({ request }) => {
    const res = await request.get('/api/sell/shortlink/check?slug=algo')
    expect(res.status()).toBe(401)
  })
})
