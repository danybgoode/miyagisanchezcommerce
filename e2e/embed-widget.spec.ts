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

  test('loader also registers the <miyagi-product> card (US-4)', async ({ request }) => {
    const body = await (await request.get('/embed.js')).text()
    expect(body).toContain("customElements.define('miyagi-product'")
    // Card uses Shadow DOM so the host page's CSS can't bleed in or out.
    expect(body).toContain('attachShadow')
  })

  test('loader registers <miyagi-support-widget> with lightbox checkout handoff', async ({ request }) => {
    const body = await (await request.get('/embed.js')).text()
    expect(body).toContain("customElements.define('miyagi-support-widget'")
    expect(body).toContain('/api/embed/support')
    expect(body).toContain('/api/embed/support/checkout')
    expect(body).toContain('mi-backdrop')
    expect(body).toContain('miyagi:support:success')
  })

  test('support widget launcher floats by default and still supports inline placement', async ({ request }) => {
    const body = await (await request.get('/embed.js')).text()
    expect(body).toContain("supportLayout(value)")
    expect(body).toContain("supportPosition(value)")
    expect(body).toContain("value === 'inline'")
    expect(body).toContain("value === 'bottom-left'")
    expect(body).toContain("position:fixed")
    expect(body).toContain("safe-area-inset-bottom")
    expect(body).toContain("data-preview")
    expect(body).toContain("data-preview-state")
    expect(body).toContain("prepareModalState")
    expect(body).toContain("preview_checkout")
  })

  test('loader threads data-accent + data-locale and is bilingual (US-7)', async ({ request }) => {
    const body = await (await request.get('/embed.js')).text()
    // Brand accent + locale are read from the element's data- attributes.
    expect(body).toContain("getAttribute('data-accent')")
    expect(body).toContain("getAttribute('data-locale')")
    // Both locales ship inside the standalone loader (no app i18n at runtime).
    expect(body).toContain('Comprar')   // es default
    expect(body).toContain('Buy now')   // en
    expect(body).toContain('Apoyar')    // support widget es
    expect(body).toContain('Support')   // support widget en
  })
})
