import { test, expect } from '@playwright/test'
import { buyerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * S3.1 — CP-first address order (Delivery & Manual-Money Polish, Sprint 3).
 *
 * Asserts the checkout address form leads with the CP, and name/phone + the rest
 * of the address reveal only once a valid CP resolves (progressive disclosure).
 *
 * Checkout is **auth-gated** (the page redirects anonymous visitors to sign-in),
 * so this is an authed browser smoke: it runs against a dev/preview via
 * @clerk/testing ticket sign-in and **skips gracefully** when the credentials /
 * the shippable-listing fixture aren't set. Enable with MS_TEST_BROWSER_AUTH=1 +
 * dev Clerk keys + MS_TEST_BUYER_EMAIL + MS_TEST_SHIPPABLE_LISTING_ID (a listing
 * whose seller offers Envía shipping). The live confirmation is owed to Daniel.
 */
const SHIPPABLE_LISTING_ID = process.env.MS_TEST_SHIPPABLE_LISTING_ID

function cpInput(page: import('@playwright/test').Page) {
  return page.getByPlaceholder('Código postal (CP)')
}
function nameInput(page: import('@playwright/test').Page) {
  return page.getByPlaceholder('Nombre de quien recibe')
}

test.describe('checkout · CP-first address order (browser)', () => {
  test('CP leads; name/phone reveal only after a valid CP resolves (S3.1)', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
    const email = requireEnv(buyerEmail(), 'MS_TEST_BUYER_EMAIL')
    const listingId = requireEnv(SHIPPABLE_LISTING_ID, 'MS_TEST_SHIPPABLE_LISTING_ID')

    await signIn(page, email)
    await page.goto(`/checkout?listingId=${listingId}`)

    // The address form only mounts under a delivery method that requires an address.
    // If shipping isn't the default selection, pick it.
    if (!(await cpInput(page).isVisible().catch(() => false))) {
      const shipping = page.getByRole('button', { name: /env[ií]o|paqueter/i }).first()
      if (await shipping.isVisible().catch(() => false)) await shipping.click()
    }

    const cp = cpInput(page)
    await expect(cp).toBeVisible()

    // Progressive disclosure: name is hidden until a CP resolves.
    await expect(nameInput(page)).toHaveCount(0)

    // Enter a valid CDMX CP; the lookup auto-fills and reveals the rest.
    await cp.fill('06000')
    const name = nameInput(page)
    await expect(name).toBeVisible({ timeout: 10_000 })

    // CP renders above name (CP-first).
    const cpBox = await cp.boundingBox()
    const nameBox = await name.boundingBox()
    expect(cpBox && nameBox && cpBox.y < nameBox.y).toBeTruthy()

    // The auto-fill populated estado/alcaldía (read-only confirmation badges).
    await expect(page.getByText('Estado', { exact: true })).toBeVisible()
    await expect(page.getByText('Alcaldía / Municipio', { exact: true })).toBeVisible()
  })
})
