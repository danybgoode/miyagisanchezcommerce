import { test, expect, type Page } from '@playwright/test'
import { sellerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Shop Settings refactor · Sprint 2 — characterization smokes for the 7 extracted
 * low-risk sections. After lifting each `#section` out of the ShopSettings
 * monolith into its own code-split component, these assert the section still
 * renders its full field set on its focused route — i.e. behavior is preserved.
 *
 * The canonical taxonomy bundles 9 monolith sections into 7 slug routes:
 *   diseno = apariencia + tipo · envios = comunicacion + envios.
 *
 * The settings surface is **auth-gated**, so these are authed browser smokes:
 * they run against a dev server via @clerk/testing ticket sign-in and **skip
 * gracefully** when the credentials aren't set. Enable with MS_TEST_BROWSER_AUTH=1
 * + dev Clerk keys + MS_TEST_SELLER_EMAIL. The live save round-trips are owed to Daniel.
 */
test.describe('shop-settings · Sprint 2 section extractions (browser)', () => {
  async function open(page: Page, slug: string) {
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')
    await signIn(page, email)
    await page.goto(`/shop/manage/settings/${slug}`)
  }

  test.beforeEach(() => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
  })

  test('Perfil renders name / description / location fields', async ({ page }) => {
    await open(page, 'perfil')
    const section = page.locator('#perfil')
    await expect(section).toBeVisible()
    await expect(section.getByText('Perfil de tienda')).toBeVisible()
    await expect(section.getByText('Nombre de tienda')).toBeVisible()
    await expect(section.getByText(/Descripción/)).toBeVisible()
    await expect(section.getByText('Estado / State')).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  test('Diseño bundles apariencia + tipo (banner, color, presets)', async ({ page }) => {
    await open(page, 'diseno')
    await expect(page.locator('#apariencia')).toBeVisible()
    await expect(page.locator('#tipo')).toBeVisible()
    await expect(page.getByText('Banner de tienda')).toBeVisible()
    await expect(page.getByText('Color de marca')).toBeVisible()
    await expect(page.getByText('Tipo de tienda')).toBeVisible()
    // A store-type preset renders + applying it reveals the "Configuración aplicada" summary.
    await page.locator('#tipo').getByRole('button', { name: /Tienda general/ }).click()
    await expect(page.getByText('Configuración aplicada:')).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  test('Negociación renders trust gate + auto-negotiation toggle', async ({ page }) => {
    await open(page, 'negociacion')
    const section = page.locator('#ofertas')
    await expect(section).toBeVisible()
    await expect(section.getByText('Nivel mínimo de comprador')).toBeVisible()
    await expect(section.getByText('Negociación automática')).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  test('Envíos bundles comunicacion + envios (contact + origin address)', async ({ page }) => {
    await open(page, 'envios')
    await expect(page.locator('#comunicacion')).toBeVisible()
    await expect(page.locator('#envios')).toBeVisible()
    await expect(page.getByText('Entrega en mano / recoger en tienda')).toBeVisible()
    await expect(page.getByText('Dirección de origen')).toBeVisible()
    // The pickup-spot manager (most-state piece) offers its add affordance.
    await expect(page.getByRole('button', { name: /Agregar punto de entrega/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  test('Citas renders booking links + Cal.com connect', async ({ page }) => {
    await open(page, 'citas')
    const section = page.locator('#citas')
    await expect(section).toBeVisible()
    await expect(section.getByText('Citas y Reservas')).toBeVisible()
    await expect(section.getByText('Mis enlaces de reservas')).toBeVisible()
    await expect(section.getByText(/Cal\.com/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  test('Pedidos renders processing time + dispatch windows', async ({ page }) => {
    await open(page, 'pedidos')
    const section = page.locator('#pedidos')
    await expect(section).toBeVisible()
    await expect(section.getByText('Tiempo de procesamiento')).toBeVisible()
    await expect(section.getByText('Ventana de despacho')).toBeVisible()
    await expect(section.getByText('Confirmación automática de entrega')).toBeVisible()
    await expect(page.getByRole('button', { name: /Guardar cambios/ })).toBeVisible()
  })

  test('Notificaciones renders the email toggles + the granular preference center', async ({ page }) => {
    await open(page, 'notificaciones')
    const section = page.locator('#notificaciones')
    await expect(section).toBeVisible()
    await expect(section.getByText('Notificaciones por correo')).toBeVisible()
    await expect(section.getByText('Nuevo mensaje de un comprador')).toBeVisible()
    // The separate granular-notifications island still renders below (its own save).
    await expect(page.getByText('Guardar cambios')).toBeVisible()
  })
})
