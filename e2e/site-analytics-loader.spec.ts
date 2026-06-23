import { test, expect } from '@playwright/test'
import { shouldLoadAnalytics } from '../lib/analytics-gating'

/**
 * Site-wide GTM container loader — api gate (S1.3).
 *
 * Two halves, matching how the loader actually works:
 *  • SSR marker — `<SiteAnalytics>` is mounted in the static root layout, so it
 *    renders an invisible `data-site-analytics` marker on every platform page.
 *    An anonymous request to the public root sees it directly in the SSR HTML.
 *  • The WHERE decision is made client-side from `window.location` (so the static
 *    `(site)` subtree reads no headers), and middleware strips spoofed `x-miyagi-*`
 *    headers — so a white-label/embed render can't be simulated from an api request.
 *    The exclusion (embed + seller white-label) is therefore asserted through the
 *    same pure gate the loader calls. The seller dashboard `/shop/manage` is
 *    auth-gated (404 anonymously), so its "loads here too" coverage is the gate's.
 */
test.describe('site-analytics loader · marker + gate', () => {
  test('the SiteAnalytics marker renders on the public marketplace root', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    expect(html).toContain('data-site-analytics')
  })

  test('the gate loads analytics on the platform surfaces, incl. the seller dashboard', () => {
    const host = 'miyagisanchez.com'
    expect(shouldLoadAnalytics({ hostname: host, pathname: '/' })).toBe(true)
    expect(shouldLoadAnalytics({ hostname: host, pathname: '/shop/manage' })).toBe(true)
    expect(shouldLoadAnalytics({ hostname: host, pathname: '/account/compras' })).toBe(true)
  })

  test('the gate excludes the embed widget and seller white-label channels', () => {
    // Embed widget — by path, even on the platform host.
    expect(shouldLoadAnalytics({ hostname: 'miyagisanchez.com', pathname: '/embed/s/x' })).toBe(false)
    // Shop subdomain — white-label.
    expect(shouldLoadAnalytics({ hostname: 'una-tienda.miyagisanchez.com', pathname: '/' })).toBe(false)
    // Seller custom domain — white-label own channel.
    expect(shouldLoadAnalytics({ hostname: 'tienda-propia.mx', pathname: '/' })).toBe(false)
  })
})
