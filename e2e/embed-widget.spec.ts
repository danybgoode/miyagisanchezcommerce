import { test, expect } from '@playwright/test'

/**
 * Embeddable Widget · Sprint 2 (US-3) — the loader script.
 * The widget is included via <script src=".../embed.js"> from any third-party
 * site, so the loader must be served as JavaScript, CORS-open, and must register
 * the custom element it promises. All read-only.
 *
 * The full buy-button → hosted-popup → live checkout hand-off is a money path,
 * so it's covered by Daniel's browser smoke (live confirmation), not here.
 */
test.describe('Embed widget — loader script', () => {
  test('embed.js is served as CORS-open JavaScript', async ({ request }) => {
    const res = await request.get('/embed.js')
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toContain('javascript')
    // Must be loadable cross-origin (and fetchable for QA from a foreign origin).
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })

  test('loader registers <miyagi-buy-button> and hands off to hosted checkout', async ({ request }) => {
    const body = await (await request.get('/embed.js')).text()
    // Registers the custom element …
    expect(body).toContain("customElements.define('miyagi-buy-button'")
    // … reads the listing from the public UCP catalog …
    expect(body).toContain('/api/ucp/catalog/')
    // … and hands off to OUR hosted checkout tagged channel=embed (no on-host payment).
    expect(body).toContain('/checkout?listingId=')
    expect(body).toContain('channel=embed')
  })
})
