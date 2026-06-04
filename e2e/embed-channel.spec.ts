import { test, expect } from '@playwright/test'

/**
 * Embeddable Widget · Sprint 1 (US-2) — embed channel + cross-origin reads.
 * Confirms an embed-marked, cross-origin read of the shared catalog still
 * succeeds (CORS open, rate-limiter passes a single request through).
 *
 * The `channel=embed` → checkout-metadata tagging is a mutating flow, so it's
 * covered by live confirmation (a real embed checkout on a test shop), not here.
 */
test.describe('Embed channel — cross-origin reads', () => {
  test('embed-marked catalog read from a foreign origin succeeds with CORS', async ({ request }) => {
    const res = await request.get('/api/ucp/catalog?channel=embed&limit=1', {
      headers: { Origin: 'https://example.com' },
    })
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['access-control-allow-origin']).toBe('*')
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
  })

  test('catalog OPTIONS preflight is embeddable', async ({ request }) => {
    const res = await request.fetch('/api/ucp/catalog', { method: 'OPTIONS' })
    expect(res.status()).toBe(204)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })
})
