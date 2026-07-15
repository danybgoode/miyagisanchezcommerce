import { test, expect } from '@playwright/test'
import es from '../locales/es.json' with { type: 'json' }

/**
 * Homepage Polish — Dirección B · Sprint 3 (Chrome & community · api gate).
 *
 * Anonymous request → the home page renders the signed-out chrome. The home
 * page uses a server-side `currentUser()` (null for an anonymous request), so:
 *   - S3.1 hero renders for the signed-out (anonymous) viewer (superseded the
 *     value-prop ribbon entirely — home-dynamic-rows-restore-and-polish S3.1).
 *   - S3.3 footer renders for every buyer-chrome page and is mobile-visible.
 *   - S3.4 keeps the Vecindario entry's stable testid on a /vecindario anchor,
 *     whether the live strip has items or falls back to the banner.
 *
 * The signed-in *absence* of the hero is enforced by the client `AuthShow`
 * gate in app/(site)/page.tsx; the api project holds no session, so that path
 * is covered by code review + the (anonymous) browser smoke, not asserted here.
 */
test.describe('home chrome · hero + footer + vecindario entry', () => {
  test('S3.1 — the signed-out hero renders with its heading', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    expect(html).toContain('data-testid="home-hero"')
    expect(html).toContain(es.home.hero.heading)
  })

  test('S3.3 — the footer is mobile-visible (no `hidden`) and carries Términos', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    expect(html).toContain('data-testid="site-footer"')

    // Regression guard: the footer must not be desktop-only (`hidden md:block`).
    const footerTag = html.match(/<footer[^>]*data-testid="site-footer"[^>]*>/)?.[0] ?? ''
    expect(footerTag).not.toBe('')
    expect(footerTag).not.toContain('hidden')

    // The Términos link is present in the footer links row.
    expect(html).toContain('href="/terminos"')

    // mobile-clerk-account-management fast-follow — the footer now also
    // carries "Acerca de" (/acerca had no footer/nav entry point before).
    expect(html).toMatch(/href="\/acerca"[^>]*>\s*Acerca de/)
  })

  test('S3.4 — the Vecindario entry keeps its testid on a /vecindario anchor', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    // Holds whether the live strip rendered items or fell back to the banner.
    expect(html).toContain('data-testid="vecindario-feed-entry"')
    expect(html).toMatch(
      /<a[^>]*data-testid="vecindario-feed-entry"[^>]*href="\/vecindario"[^>]*>|<a[^>]*href="\/vecindario"[^>]*data-testid="vecindario-feed-entry"[^>]*>/,
    )
  })
})
