import { expect, test } from '@playwright/test'
import { shouldLoadAnalytics } from '../lib/analytics-gating'

/**
 * Pure-logic gate for the site-wide GTM container (S1.1). No DOM / no network —
 * exercises the rule the `<SiteAnalytics>` loader relies on directly.
 *
 * Load on every platform surface; skip on the white-label channels (custom domain,
 * shop subdomain) and the embed widget.
 */
test.describe('analytics-gating · shouldLoadAnalytics', () => {
  test('loads on the public marketplace + every platform surface', () => {
    const load = (pathname: string) =>
      shouldLoadAnalytics({ hostname: 'miyagisanchez.com', pathname })
    expect(load('/')).toBe(true) // marketplace home
    expect(load('/l')).toBe(true) // catalog
    expect(load('/s/alguna-tienda')).toBe(true) // a shop ON the platform host
    expect(load('/shop/manage')).toBe(true) // seller dashboard
    expect(load('/shop/manage/pedidos')).toBe(true)
    expect(load('/checkout')).toBe(true) // checkout
    expect(load('/account/compras')).toBe(true) // account
    expect(load('/vende')).toBe(true) // seller pitch
  })

  test('loads on www and a Vercel preview host', () => {
    expect(shouldLoadAnalytics({ hostname: 'www.miyagisanchez.com', pathname: '/' })).toBe(true)
    expect(shouldLoadAnalytics({ hostname: 'miyagi-git-feat-x.vercel.app', pathname: '/' })).toBe(true)
  })

  test('loads on localhost (dev)', () => {
    expect(shouldLoadAnalytics({ hostname: 'localhost', pathname: '/' })).toBe(true)
    expect(shouldLoadAnalytics({ hostname: '127.0.0.1', pathname: '/shop/manage' })).toBe(true)
    // Host header may carry a port in dev — stripped before matching.
    expect(shouldLoadAnalytics({ hostname: 'localhost:3001', pathname: '/' })).toBe(true)
  })

  test('skips the embed widget by PATH, even on the platform host', () => {
    expect(shouldLoadAnalytics({ hostname: 'miyagisanchez.com', pathname: '/embed' })).toBe(false)
    expect(shouldLoadAnalytics({ hostname: 'miyagisanchez.com', pathname: '/embed/s/una-tienda' })).toBe(false)
    expect(shouldLoadAnalytics({ hostname: 'miyagisanchez.com', pathname: '/embed/l/abc123' })).toBe(false)
  })

  test('skips a shop subdomain (white-label)', () => {
    expect(shouldLoadAnalytics({ hostname: 'mi-tienda.miyagisanchez.com', pathname: '/' })).toBe(false)
    expect(shouldLoadAnalytics({ hostname: 'mi-tienda.miyagisanchez.com', pathname: '/l/abc' })).toBe(false)
  })

  test('skips a seller custom domain (white-label own channel)', () => {
    expect(shouldLoadAnalytics({ hostname: 'tienda-propia.mx', pathname: '/' })).toBe(false)
    expect(shouldLoadAnalytics({ hostname: 'www.tienda-propia.mx', pathname: '/l/abc' })).toBe(false)
  })

  test('reserved/infra subdomains are NOT shops — they fall through, not loaded as a storefront', () => {
    // clerk/accounts/api aren't shop subdomains, and aren't in PLATFORM_HOSTS, so they
    // don't load analytics (they aren't browsable storefronts). The point: they are not
    // mis-treated as a shop subdomain either way.
    expect(shouldLoadAnalytics({ hostname: 'clerk.miyagisanchez.com', pathname: '/' })).toBe(false)
  })

  test('degrades to false on a missing/blank hostname', () => {
    expect(shouldLoadAnalytics({ hostname: '', pathname: '/' })).toBe(false)
    expect(shouldLoadAnalytics({ hostname: null, pathname: '/' })).toBe(false)
    expect(shouldLoadAnalytics({ hostname: undefined, pathname: undefined })).toBe(false)
  })
})
