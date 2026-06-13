import { test, expect } from '@playwright/test'

/**
 * Persistent search + one agent entry (Nav & Settings Reorg — Sprint 2) —
 * real-browser, ANONYMOUS.
 *
 * The header is layout-level (identical on every page); `/terminos` is anonymous
 * with no catalog dependency, so these assertions are deterministic in any
 * environment and go green only where this sprint is deployed. Covers Story 2.1
 * (persistent + centered desktop search) and 2.3 (no bare ✨; one "Agente IA"
 * affordance). The authed Cuenta-menu open stays owed to Daniel.
 */

test.describe('header search + agent entry (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('renders a centered search with the Agente IA affordance, no bare ✨ link', async ({ page }) => {
    await page.goto('/terminos')

    const header = page.locator('header').first()

    // Two search inputs exist (mobile `md:hidden` + desktop `hidden md:flex`);
    // `:visible` picks the one shown at this breakpoint — here the desktop one.
    const search = header.locator('input[name="q"]:visible')
    await expect(search).toBeVisible()
    await expect(search).toHaveAttribute('placeholder', '¿Qué estás buscando?')

    // The single agent entry is a LABELED affordance, not a bare icon.
    const agent = header.getByRole('button', { name: 'Agente IA' })
    await expect(agent).toBeVisible()

    // No bare standalone agent LINK in the header (the old desktop ✨ sparks link).
    await expect(header.locator('a[href="/agent"]')).toHaveCount(0)

    // "Centered": the search sits between the brand (left) and the right nav.
    const headerBox = (await header.boundingBox())!
    const searchBox = (await search.boundingBox())!
    const searchCenter = searchBox.x + searchBox.width / 2
    const headerCenter = headerBox.x + headerBox.width / 2
    // Within a generous band of the header's horizontal center.
    expect(Math.abs(searchCenter - headerCenter)).toBeLessThan(headerBox.width * 0.18)
  })
})

test.describe('header search (mobile/PWA width)', () => {
  test.use({ viewport: { width: 390, height: 800 } })

  test('search input renders at phone width (persistent, was .pwa-search-hide)', async ({ page }) => {
    await page.goto('/terminos')
    const header = page.locator('header').first()
    await expect(header.locator('input[name="q"]:visible')).toBeVisible()
  })
})
