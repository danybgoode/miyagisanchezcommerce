import { test, expect } from '@playwright/test'
import { authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Homepage Selección · S2.2 — `/admin/seleccion` render smoke (browser project,
 * NOT the gate).
 *  - Anonymous: `requireAdmin()` redirects to `/` (assertable without credentials).
 *  - Authed admin: the curation screen renders. Needs a dev-instance admin user
 *    `MS_TEST_ADMIN_EMAIL` + `MS_TEST_BROWSER_AUTH=1`; skips gracefully otherwise.
 *    The full pin → drag → homepage-reflects flow is owed to Daniel on prod.
 */

function adminEmail(): string | null {
  return process.env.MS_TEST_ADMIN_EMAIL || null
}

test.describe('admin · /admin/seleccion', () => {
  test('anonymous visitor is redirected away (requireAdmin)', async ({ page }) => {
    await page.goto('/admin/seleccion')

    // Anywhere-but-admin, stated as such. The subject here is the REFUSAL, and every
    // landing spot that is not the admin screen satisfies it equally: `/`, `/en` (an
    // English browser is hopped to the English root after hydration — #399), or
    // `/sign-in`. The previous pattern named only two of those and went red the day
    // `/en` shipped, on a spec about authorization, in a suite whose default locale
    // was `en-US`. Pinning the suite to es-MX (playwright.config.ts) fixes the cause;
    // this makes the assertion honest about what it is actually checking, so it holds
    // whatever locale a future reader runs it under.
    // The `(\?.*)?` is not defensive padding — without it the pattern accepts `/sign-in`
    // while rejecting the only form `/sign-in` ever takes. Clerk appends the return
    // path: `/sign-in?redirect_url=…%2Fadmin%2Fseleccion` (observed live on this
    // codebase's own auth-gated routes). A pattern that names a landing spot and then
    // fails on it is a guard rejecting correct output, which is how guards get deleted.
    // Caught by the agy cross-family pass — the same review round where the other
    // family's two findings did not hold up.
    await expect(page).toHaveURL(/\/(en|sign-in)?(\?.*)?$/)

    // This is the assertion that carries the security meaning — the one that must
    // never be relaxed. It is why widening the URL pattern above costs nothing.
    await expect(page.locator('h1', { hasText: 'Selección de la semana' })).toHaveCount(0)
  })

  test('an admin sees the curation screen', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 to run authed admin smokes')
    const email = requireEnv(adminEmail(), 'MS_TEST_ADMIN_EMAIL')
    await signIn(page, email)
    await page.goto('/admin/seleccion')
    await expect(page.locator('h1', { hasText: 'Selección de la semana' })).toBeVisible()
    await expect(page.getByText('Candidatos')).toBeVisible()
  })
})
