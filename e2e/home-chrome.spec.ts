import { test, expect } from '@playwright/test'

/**
 * Homepage Polish — Dirección B · Sprint 3 (Chrome & community · api gate).
 *
 * Anonymous request → the home page renders the signed-out chrome. The home
 * page uses a server-side `currentUser()` (null for an anonymous request), so:
 *   - S3.1 ribbon renders for the signed-out (anonymous) viewer.
 *   - S3.3 footer renders for every buyer-chrome page and is mobile-visible.
 *   - S3.4 keeps the Vecindario entry's stable testid on a /vecindario anchor,
 *     whether the live strip has items or falls back to the banner.
 *
 * The signed-in *absence* of the ribbon is enforced by the `!isSignedIn`
 * conditional in app/page.tsx; the api project holds no session, so that path
 * is covered by code review + the (anonymous) browser smoke, not asserted here.
 */
test.describe('home chrome · ribbon + footer + vecindario entry', () => {
  test('S3.1 — the signed-out value-prop ribbon renders and links to /acerca', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    expect(html).toContain('data-testid="home-ribbon"')
    // "Cómo funciona" sits inside an /acerca anchor (href rendered last by Next).
    expect(html).toMatch(/href="\/acerca"[^>]*>\s*Cómo funciona/)
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
