import { test, expect, type Page } from '@playwright/test'

/**
 * PWA bottom bar (PWA Liquid-Glass Nav Polish — Sprint 1) — real-browser, ANONYMOUS.
 *
 * The bar is gated behind `@media (display-mode: standalone) and (max-width: 767px)`
 * (`.pwa-only`). `display-mode` is NOT an emulatable media feature in headless
 * Chromium (verified: CDP `Emulation.setEmulatedMedia` leaves
 * `matchMedia('(display-mode: standalone)')` false), so an automated browser cannot
 * satisfy that gate. The media gate itself is trivial, separately-trusted CSS — this
 * spec uses a phone viewport + a test-only `display:flex` override to FORCE the bar
 * visible, then asserts the React render + the hide-on-scroll JS (the parts an API
 * call can't see). The genuine PWA-standalone install, the real-device keyboard hide,
 * the PWA-only Favoritos dedup, and the device glass look stay owed to Daniel.
 *
 * Covers S1.1 (the reordered set Inicio · Mensajes · ⊕ Vender · Favoritos · Perfil,
 * Explorar gone) + S1.2 (the detached search control present) and the hide-on-scroll +
 * route-hide. The set/order *decision* is also unit-tested in `tabbar-visibility.spec.ts`;
 * here we prove the wiring renders it.
 *
 * Render/scroll target `/terminos`: the bar is layout-level (identical on every page)
 * and that page is anonymous with no catalog dependency, so the test is deterministic
 * in any environment. It asserts the NEW shape, so it goes green only where this
 * sprint is deployed.
 */
async function gotoWithBarForced(page: Page, path: string) {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(path)
  await page.addStyleTag({ content: '.pwa-only { display: flex !important; }' })
}

test.describe('PWA bottom bar (standalone)', () => {
  test('renders the reordered set + the detached search control', async ({ page }) => {
    await gotoWithBarForced(page, '/terminos')

    // .pwa-only is shared by the search sheet + shell; target the bar root by testid.
    const bar = page.locator('[data-testid="pwa-tabbar"]')
    await expect(bar).toBeVisible()

    // The four tabs + the FAB render as links (by name).
    for (const name of ['Inicio', 'Mensajes', 'Vender', 'Favoritos', 'Perfil']) {
      await expect(bar.getByRole('link', { name, exact: true })).toBeVisible()
    }
    // The detached search control is now a sheet-opening BUTTON (S2.1 shipped — it
    // no longer links to /l), so assert the button + its dialog affordance.
    const search = bar.getByRole('button', { name: 'Buscar', exact: true })
    await expect(search).toBeVisible()
    await expect(search).toHaveAttribute('aria-haspopup', 'dialog')

    // Gone this sprint: the Explorar tab (search moved to the detached control).
    await expect(bar.getByRole('link', { name: 'Explorar' })).toHaveCount(0)
    // No "Cuenta"/"Entrar" tab anymore — it's "Perfil" now.
    await expect(bar.getByRole('link', { name: 'Cuenta', exact: true })).toHaveCount(0)

    // FAB → publish flow.
    await expect(bar.getByRole('link', { name: 'Vender', exact: true }))
      .toHaveAttribute('href', '/sell')
    // Auth-gated tabs point at sign-in while signed out.
    await expect(bar.getByRole('link', { name: 'Favoritos', exact: true }))
      .toHaveAttribute('href', '/sign-in')
  })

  test('hides on scroll-down and springs back on scroll-up', async ({ page }) => {
    await gotoWithBarForced(page, '/terminos')

    // .pwa-only is shared by the search sheet + shell; target the bar root by testid.
    const bar = page.locator('[data-testid="pwa-tabbar"]')
    await expect(bar).toBeVisible()

    // Guarantee the page is scrollable regardless of content height.
    await page.evaluate(() => {
      const spacer = document.createElement('div')
      spacer.style.height = '3000px'
      document.body.appendChild(spacer)
    })

    const visibleTop = (await bar.boundingBox())!.y

    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(async () => (await bar.boundingBox())!.y).toBeGreaterThan(visibleTop + 40)

    await page.evaluate(() => window.scrollTo(0, 100))
    await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThanOrEqual(visibleTop + 5)
  })

  test('is removed entirely on a product page (/l/[id])', async ({ page, request }) => {
    let id: string | undefined
    try {
      // Bounded: locally the catalog route blocks on unreachable Medusa — time it
      // out and skip rather than hang. On preview/prod it answers fast.
      const cat = await request.get('/api/ucp/catalog?limit=1', { timeout: 8000 })
      id = (await cat.json())?.items?.[0]?.id as string | undefined
    } catch { /* catalog unreachable (e.g. local without Medusa) → skip */ }
    test.skip(!id, 'no active listings in this environment')

    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(`/l/${id}`)

    // The component returns null on a PDP, so the bar isn't in the DOM at all
    // (independent of the CSS gate — no override needed). Assert on the bar root's
    // testid, not .pwa-only (which the shell/search sheet also use elsewhere).
    await expect(page.locator('[data-testid="pwa-tabbar"]')).toHaveCount(0)
  })
})
