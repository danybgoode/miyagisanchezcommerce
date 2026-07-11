import { test, expect, type Page } from '@playwright/test'
import { sellerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Shop Settings refactor · Sprint 3 — characterization smokes for the HIGH-risk
 * money/domain/agent sections lifted out of the ShopSettings monolith:
 *   pagos = proteccion + stripe + mercadopago + spei
 *   canal-propio (own page, catalog-management S6.2) = custom domain + free URL + widget
 *   apoyo (settings card, catalog-management S6.2) = support widget
 *   agentes = webhook + agent token + MCP snippet
 *
 * These assert each section still renders its full field set on its focused route
 * (behavior preserved). The live money/domain/token round-trips (MP connect, CLABE
 * save, domain add/verify, agent-token issue/revoke) are owed to Daniel — see the
 * sprint-3.md smoke walkthrough.
 *
 * Auth-gated → authed browser smokes via @clerk/testing ticket sign-in; **skip
 * gracefully** without MS_TEST_BROWSER_AUTH=1 + dev Clerk keys + MS_TEST_SELLER_EMAIL.
 */
test.describe('shop-settings · Sprint 3 money/domain/agent extractions (browser)', () => {
  async function open(page: Page, slug: string) {
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')
    await signIn(page, email)
    await page.goto(`/shop/manage/settings/${slug}`)
  }

  async function openPath(page: Page, path: string) {
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')
    await signIn(page, email)
    await page.goto(path)
  }

  test.beforeEach(() => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
  })

  test('Pagos bundles proteccion + stripe + mercadopago + spei', async ({ page }) => {
    await open(page, 'pagos')
    await expect(page.locator('#proteccion')).toBeVisible()
    await expect(page.locator('#stripe')).toBeVisible()
    await expect(page.locator('#mercadopago')).toBeVisible()
    await expect(page.locator('#spei')).toBeVisible()
    await expect(page.getByText('Compra Protegida')).toBeVisible()
    await expect(page.getByText('Pagos con tarjeta (Stripe)')).toBeVisible()
    await expect(page.getByText('Mercado Pago')).toBeVisible()
    await expect(page.locator('#spei').getByText('Transferencia SPEI (CLABE)')).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  // catalog-management S6.2 split the old bundled `canal` section into its own
  // Catálogo-group page (federation: domain/subdomain/free URL/embed) + a
  // standalone Apoyo settings card (support widget) — two tests instead of one.
  test('Canales (canal-propio) bundles custom domain + free URL + embed (widget)', async ({ page }) => {
    await openPath(page, '/shop/manage/canal-propio')
    await expect(page.locator('#canal')).toBeVisible()
    await expect(page.locator('#widget')).toBeVisible()
    await expect(page.locator('#canal').getByText('Canal Propio')).toBeVisible()
    await expect(page.getByText('Tu URL gratis')).toBeVisible()
    // The domain entry input (custom-domain flow) is present.
    await expect(page.getByPlaceholder('tutienda.mx')).toBeVisible()
    // No page-level save bar here — domain/slug persist through their own
    // endpoints, never through useSettingsSave() (unlike every other section).
  })

  test('Apoyo (support widget) settings card', async ({ page }) => {
    await open(page, 'apoyo')
    await expect(page.locator('#apoyo')).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  test('Agentes renders webhook + agent-token + MCP config snippet', async ({ page }) => {
    await open(page, 'agentes')
    const section = page.locator('#webhook')
    await expect(section).toBeVisible()
    await expect(section.getByText('Conectar tu sistema')).toBeVisible()
    await expect(section.getByText('URL de notificación')).toBeVisible()
    await expect(section.getByText('Token para tu agente (MCP)')).toBeVisible()
    // The agent-token issue affordance + the ready-to-paste MCP config block.
    await expect(section.getByRole('button', { name: /token de agente|Regenerar token/ })).toBeVisible()
    await expect(section.getByText('Conecta tu agente')).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })
})
