import { test, expect } from '@playwright/test'

/**
 * Homepage Selección — Sprint 1 (auth-state leakage · api gate).
 *
 * After the static-shell migration the homepage is a prerendered CDN asset, so the
 * signed-out/in branch is now a CLIENT gate (`AuthShow`, `useAuth`, no `headers()`).
 * `AuthShow` defaults to the signed-OUT branch during SSR/prerender (`isLoaded === false`
 * ⇒ not signed in), so the signed-out CTAs must still be present in the anonymous static
 * HTML — that's what this api spec locks. It cannot assert the *signed-in absence* of
 * these CTAs: the api project holds no Clerk session, and the auth/island path can't
 * false-pass on a `*.vercel.app` preview (LEARNINGS) — that eyeball is owed to Daniel
 * on prod. Code review + this anonymous-present assertion are the deterministic half.
 *
 * Note Next renders an `<a>`'s `href` LAST (`<a class=… href="/x">text`), so href-last
 * regexes are the robust form (LEARNINGS, nav-reorg S4).
 */
test.describe('home auth-state · signed-out CTAs prerender into the static HTML', () => {
  test('S1.2 — the "Únete a la comunidad" recruit CTA is present for anonymous (signed-out) viewers', async ({
    request,
  }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    // The terminal recruit section prerenders, AND its OWN "Crear cuenta" button points
    // to /sign-up — scoped via the testid so a stray footer /sign-up can't pass this test.
    expect(html).toContain('Únete a la comunidad')
    const uneteLink = html.match(/<a[^>]*data-testid="home-unete-signup"[^>]*>/)?.[0] ?? ''
    expect(uneteLink).not.toBe('')
    expect(uneteLink).toContain('href="/sign-up"')
  })

  test('S1.3 — the footer "Crear cuenta" → /sign-up link prerenders for anonymous viewers', async ({
    request,
  }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()

    // Footer is gated by AuthShow when="signed-out"; the signed-out HTML still prerenders.
    // Scoped to the footer's OWN /sign-up link (testid) so the section CTA can't pass it.
    expect(html).toContain('data-testid="site-footer"')
    const footerLink = html.match(/<a[^>]*data-testid="footer-signup"[^>]*>/)?.[0] ?? ''
    expect(footerLink).not.toBe('')
    expect(footerLink).toContain('href="/sign-up"')
  })
})
