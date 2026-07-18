import { expect, test } from '@playwright/test'

// Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 2 · US-2.2) — the
// api-level "prefill URL round-trips a known state" spec sprint-2.md requires: a
// GET with the FULL query shape (platform/tier/volume/aov/apps/Miyagi SKUs) must
// render every one of those exact selections in the initial server HTML — no
// browser JS needed, same discipline as e2e/comparador.spec.ts's Sprint 1 spec.

test.describe('comparador · prefill URL renders the full selected state', () => {
  test('platform/tier/volume/aov/apps/Miyagi SKUs all render as selected on first load', async ({ request }) => {
    const volume = 100
    const aov = 500
    const res = await request.get(
      `/comparador?platform=shopify&tier=avanzado&volume=${volume}&aov=${aov}&apps=liveChat,coupons&sub=1&dom=1`,
      { headers: { Accept: 'text/html' } },
    )
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    // Platform + tier select the requested options.
    const platformSelect = html.match(/<select[^>]*data-testid="comparador-platform-select"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? ''
    expect(platformSelect).toContain('<option value="shopify" selected')
    const tierSelect = html.match(/<select[^>]*data-testid="comparador-shopify-tier-select"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? ''
    expect(tierSelect).toContain('<option value="avanzado" selected')

    // Volume + AOV inputs carry the requested numbers.
    const volumeInput = html.match(/<input[^>]*data-testid="comparador-volume-input"[^>]*>/)?.[0] ?? ''
    expect(volumeInput).toContain(`value="${volume}"`)
    const aovInput = html.match(/<input[^>]*data-testid="comparador-aov-input"[^>]*>/)?.[0] ?? ''
    expect(aovInput).toContain(`value="${aov}"`)

    // The two requested apps are checked; the third (not requested) is not.
    const liveChatInput = html.match(/<input[^>]*data-testid="comparador-app-liveChat"[^>]*>/)?.[0] ?? ''
    expect(liveChatInput).toContain('checked')
    const couponsInput = html.match(/<input[^>]*data-testid="comparador-app-coupons"[^>]*>/)?.[0] ?? ''
    expect(couponsInput).toContain('checked')
    const offersInput = html.match(/<input[^>]*data-testid="comparador-app-offers"[^>]*>/)?.[0] ?? ''
    expect(offersInput).not.toContain('checked')

    // Both requested Miyagi SKUs are checked; the third (ML sync, not requested) is not.
    const subdomainInput = html.match(/<input[^>]*data-testid="comparador-miyagi-subdomain"[^>]*>/)?.[0] ?? ''
    expect(subdomainInput).toContain('checked')
    const domainInput = html.match(/<input[^>]*data-testid="comparador-miyagi-domain"[^>]*>/)?.[0] ?? ''
    expect(domainInput).toContain('checked')
    const mlsyncInput = html.match(/<input[^>]*data-testid="comparador-miyagi-mlsync"[^>]*>/)?.[0] ?? ''
    expect(mlsyncInput).not.toContain('checked')

    // A computed total actually rendered (lib-vs-page no-drift for a FIXED dataset
    // is comparador.spec.ts's job, tier=basico — this spec's job is proving the
    // prefilled STATE restores, which the assertions above already cover).
    const monthlyTotal = html.match(/data-testid="comparador-monthly-competitor-total"[^>]*>([^<]+)/)?.[1] ?? ''
    expect(monthlyTotal).toMatch(/^\$[\d,]+\.\d{2}$/)
  })

  test('a plain GET with no params still defaults every toggle to unchecked (backward-compatible with Sprint 1 links)', async ({ request }) => {
    const res = await request.get('/comparador', { headers: { Accept: 'text/html' } })
    const html = await res.text()
    const subdomainInput = html.match(/<input[^>]*data-testid="comparador-miyagi-subdomain"[^>]*>/)?.[0] ?? ''
    expect(subdomainInput).not.toContain('checked')
    const liveChatInput = html.match(/<input[^>]*data-testid="comparador-app-liveChat"[^>]*>/)?.[0] ?? ''
    expect(liveChatInput).not.toContain('checked')
  })

  test('the "Copiar enlace" and "Exportar reporte" controls are present anonymously', async ({ request }) => {
    const res = await request.get('/comparador', { headers: { Accept: 'text/html' } })
    const html = await res.text()
    expect(html).toContain('data-testid="comparador-export-button"')
    expect(html).toContain('data-testid="comparador-share-link-button"')
  })
})
