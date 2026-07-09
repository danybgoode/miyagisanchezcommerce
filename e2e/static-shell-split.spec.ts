import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * marketplace-static-shell S1.3 — guards the route-group split invariant:
 *   • the marketplace `(site)` layout chain (root + `(site)/layout.tsx`) reads NO
 *     request headers, so the homepage can become a static CDN asset (S2);
 *   • the dynamic `(shell)/layout.tsx` keeps the per-request channel/header logic;
 *   • the split is invisible — the homepage still serves platform chrome anonymously,
 *     and a white-label `/embed/*` path still suppresses it.
 *
 * The static invariant is proved by source-introspection (the honest check — an HTTP
 * call can't see "this layout doesn't read headers"; in S1 the homepage page itself
 * still calls currentUser() so `/` is still dynamic until S2). Mirrors the file-read
 * pattern in marketplace-positioning.spec.ts.
 */

const SEARCH_MARKER = '¿Qué estás buscando?' // platform header search — absent on white-label

function source(relPath: string): string {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')
}

test.describe('static-shell split · static invariant', () => {
  test('the static `(site)` + root layout chain reads no request headers', () => {
    const rootLayout = source('app/layout.tsx')
    const siteLayout = source('app/(site)/layout.tsx')

    // Static-able: no per-request header/auth read anywhere in the homepage's chain.
    expect(rootLayout).not.toContain('next/headers')
    expect(rootLayout).not.toMatch(/\bheaders\(/)
    expect(rootLayout).not.toContain('x-miyagi')
    expect(siteLayout).not.toContain('next/headers')
    expect(siteLayout).not.toMatch(/\bheaders\(/)
    expect(siteLayout).not.toContain('x-miyagi')
  })

  test('the dynamic `(shell)` layout still reads the channel headers', () => {
    const shellLayout = source('app/(shell)/layout.tsx')
    expect(shellLayout).toContain('next/headers')
    expect(shellLayout).toMatch(/\bheaders\(/)
    expect(shellLayout).toContain('x-miyagi-channel')
    expect(shellLayout).toContain('x-miyagi-embed')
  })

  // admin-content-and-announcements S1.1 — the copy-override reader is deliberately
  // ISR-safe (unstable_cache, see lib/copy-overrides.ts) SO THAT a future sprint can
  // read it from this static chain without forcing `/` dynamic. Sprint 1 doesn't key
  // the homepage at all (only /vende), so this is a regression tripwire: if a later
  // change wires overrides into the homepage via the wrong (per-request) primitive,
  // this fails loud instead of silently flipping `/` off `○`.
  test('the static homepage chain does not import the copy-override reader', () => {
    const rootLayout = source('app/layout.tsx')
    const siteLayout = source('app/(site)/layout.tsx')
    const sitePage = source('app/(site)/page.tsx')

    for (const file of [rootLayout, siteLayout, sitePage]) {
      expect(file).not.toContain('lib/copy-overrides')
    }
  })
})

test.describe('static-shell split · channels unbroken', () => {
  test('the marketplace homepage still renders platform chrome anonymously', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    expect(html).toContain(SEARCH_MARKER)
    expect(html).toContain('data-testid="site-footer"')
  })

  test('a white-label /embed path still suppresses platform chrome', async ({ request }) => {
    // The embed surface is framable on ANY slug (next.config sets the CSP per-path).
    const framable = await request.get('/embed/s/__smoke__', { headers: { Accept: 'text/html' } })
    expect((framable.headers()['content-security-policy'] ?? '')).toContain('frame-ancestors')

    // Prove suppression on a REAL embed storefront (not a 404): derive a live slug from
    // the public catalog and assert the platform header's search box is absent — i.e. the
    // route-group split did not regress the `(shell)` white-label branch. Skip if the env
    // has no active listings (mirrors embed-shop.spec.ts).
    const cat = await request.get('/api/ucp/catalog?limit=1')
    expect(cat.ok()).toBeTruthy()
    const slug = (await cat.json())?.items?.[0]?.shop?.slug
    test.skip(!slug, 'no active listings in this environment')

    const shop = await request.get(`/embed/s/${slug}`, { headers: { Accept: 'text/html' } })
    expect(shop.ok()).toBeTruthy()
    expect(await shop.text()).not.toContain(SEARCH_MARKER)
  })
})
