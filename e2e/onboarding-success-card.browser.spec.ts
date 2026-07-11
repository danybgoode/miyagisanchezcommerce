import { test, expect, type Page } from '@playwright/test'
import { sellerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Browser harness — F12 convergence (onboarding-three-doors Sprint 2 · Story
 * 2.2). Asserts `<SuccessCard>` renders the same structural landmarks —
 * `data-testid="success-card"`, the live-store link, ≤2 next actions — from
 * all three entry points that end on it: SellWizard, ImportClient, and
 * SetupClient. Opt-in (`browser` project, not the blocking `api` gate),
 * credential-gated exactly like `smoke.browser.spec.ts`; skips gracefully
 * when `MS_TEST_BROWSER_AUTH`/`MS_TEST_SELLER_EMAIL` aren't set.
 *
 * NOTE: not yet run against a live dev/preview (those secrets aren't
 * provisioned yet — see WAYS-OF-WORKING "Automated QA"), so this spec is a
 * good-faith implementation against the current DOM, not a live-verified
 * one; the exact button/label selectors below may need a touch-up on first
 * real run — asserting a structural landmark (`data-testid`) rather than
 * copy keeps that risk as low as it can be without a live pass.
 */

async function assertSuccessCardLandmarks(page: Page) {
  const card = page.getByTestId('success-card')
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(card.getByRole('link', { name: /ver mi tienda pública/i })).toBeVisible()
  const actionButtons = card.locator('a.btn, button.btn').filter({ hasNotText: /whatsapp|compartir/i })
  expect(await actionButtons.count()).toBeLessThanOrEqual(2)
}

test.describe('onboarding-success-card · F12 convergence', () => {
  test.beforeEach(async () => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
  })

  test('SetupClient (agent-native apply) ends on the shared SuccessCard', async ({ page }) => {
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')
    await signIn(page, email)
    await page.goto('/sell/setup')

    const setupFile = {
      miyagi_setup_version: '1',
      profile: { name: `Tienda de prueba ${Date.now()}` },
      catalog: [{ title: `Producto de prueba ${Date.now()}`, price: 199, category: 'hogar' }],
    }
    await page.getByPlaceholder(/pega aquí el objeto json completo/i).fill(JSON.stringify(setupFile))
    await page.getByRole('button', { name: 'Revisar' }).click()
    await page.getByRole('button', { name: /crear mi tienda/i }).click()

    await assertSuccessCardLandmarks(page)
  })

  test('ImportClient (catalog import) ends on the shared SuccessCard', async ({ page }) => {
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')
    await signIn(page, email)
    await page.goto('/shop/manage/import')

    const csv = `title,price,category\nProducto de prueba ${Date.now()},199,hogar\n`
    await page.locator('input[type="file"]').setInputFiles({
      name: 'productos-prueba.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    })
    await page.getByRole('button', { name: /confirmar e importar/i }).click()

    await assertSuccessCardLandmarks(page)
  })

  test('SellWizard (manual listing) ends on the shared SuccessCard', async ({ page }) => {
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')
    await signIn(page, email)
    await page.goto('/sell')

    // Step 1 (shop) only shows for a shop-less test account — fill it if present.
    const shopNameInput = page.getByPlaceholder(/automotriz garcía/i)
    if (await shopNameInput.isVisible().catch(() => false)) {
      await shopNameInput.fill(`Tienda de prueba ${Date.now()}`)
      await page.locator('select').first().selectOption({ index: 1 })
      await page.getByRole('button', { name: /continuar/i }).click()
    }

    // Step 2 (listing)
    await page.getByPlaceholder(/iphone 14 pro/i).fill(`Producto de prueba ${Date.now()}`)
    await page.locator('.grid.grid-cols-3 button, .grid.sm\\:grid-cols-4 button').first().click()
    await page.getByText('Precio a consultar').click()
    await page.getByRole('button', { name: /publicar anuncio/i }).click()

    await assertSuccessCardLandmarks(page)
  })
})
