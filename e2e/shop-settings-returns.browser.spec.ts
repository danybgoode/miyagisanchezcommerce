import { test, expect } from '@playwright/test'
import { sellerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Shop Settings refactor · Sprint 1.3 — characterization smoke for the extracted
 * Devoluciones (returns policy) section.
 *
 * After lifting `#politicas` out of the ShopSettings monolith into its own
 * code-split component, this asserts the section still renders its full field set
 * and that the conditional condition/flete grids reveal once a positive return
 * window is chosen — i.e. behavior is preserved.
 *
 * The settings surface is **auth-gated** (the page redirects anonymous visitors
 * to sign-in), so this is an authed browser smoke: it runs against a dev server
 * via @clerk/testing ticket sign-in and **skips gracefully** when the credentials
 * aren't set. Enable with MS_TEST_BROWSER_AUTH=1 + dev Clerk keys +
 * MS_TEST_SELLER_EMAIL. The live save round-trip is owed to Daniel.
 */
test.describe('shop-settings · Devoluciones extraction (browser)', () => {
  test('renders the returns field set; condition + flete reveal on a positive window', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')

    await signIn(page, email)
    await page.goto('/shop/manage/settings/politicas')

    // The extracted section card renders with its heading + window options.
    const section = page.locator('#politicas')
    await expect(section).toBeVisible()
    await expect(section.getByText('Política de devoluciones')).toBeVisible()
    for (const label of ['14 días', '30 días', '7 días', 'Sin devoluciones']) {
      await expect(section.getByRole('button', { name: new RegExp(label) })).toBeVisible()
    }

    // Condition + flete grids are hidden until a positive window is chosen.
    await expect(section.getByText('Condición aceptada')).toHaveCount(0)

    await section.getByRole('button', { name: /14 días/ }).click()
    await expect(section.getByText('Condición aceptada')).toBeVisible()
    await expect(section.getByText('Flete de devolución')).toBeVisible()

    // The live preview reflects the chosen window.
    await expect(section.getByText(/Devoluciones: 14 días/)).toBeVisible()

    // Choosing "Sin devoluciones" collapses the condition/flete grids again.
    await section.getByRole('button', { name: /Sin devoluciones/ }).click()
    await expect(section.getByText('Condición aceptada')).toHaveCount(0)

    // The save CTA is present (the round-trip itself is owed to Daniel).
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })
})
