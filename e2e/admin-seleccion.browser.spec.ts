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
    await expect(page).toHaveURL(/\/(sign-in)?$/)
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
