import { test, expect, type Page } from '@playwright/test'

/**
 * PWA bottom bar (Nav & Settings Reorg — Sprint 1) — real-browser, ANONYMOUS.
 *
 * The bar is gated behind `@media (display-mode: standalone) and (max-width: 767px)`
 * (`.pwa-only`). `display-mode` is NOT an emulatable media feature in headless
 * Chromium (verified: CDP `Emulation.setEmulatedMedia` leaves
 * `matchMedia('(display-mode: standalone)')` false), so an automated browser cannot
 * satisfy that gate. The media gate itself is trivial, separately-trusted CSS — this
 * spec uses a phone viewport + a test-only `display:flex` override to FORCE the bar
 * visible, then asserts the React render + the hide-on-scroll JS (the parts an API
 * call can't see). The genuine PWA-standalone install + real-device keyboard hide
 * stay owed to Daniel.
 *
 * Covers Story 1.1 (exactly 4 tabs + FAB; the search circle / Favoritos / Vecindario
 * gone) and Story 1.2's hide-on-scroll + route-hide. The scroll *decision* is also
 * unit-tested in `tabbar-visibility.spec.ts`; here we prove the wiring renders it.
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
  test('renders exactly 4 tabs + the publish FAB, nothing removed', async ({ page }) => {
    await gotoWithBarForced(page, '/terminos')

    const bar = page.locator('.pwa-only')
    await expect(bar).toBeVisible()

    // The four destinations + the FAB are present (by accessible name).
    for (const name of ['Inicio', 'Explorar', 'Mensajes', 'Vender']) {
      await expect(bar.getByRole('link', { name, exact: true })).toBeVisible()
    }
    // Cuenta (signed-out → "Entrar").
    await expect(
      bar.getByRole('link', { name: 'Cuenta', exact: true })
        .or(bar.getByRole('link', { name: 'Entrar', exact: true })),
    ).toBeVisible()

    // Removed in this sprint: the detached search circle, Favoritos, Vecindario.
    await expect(bar.getByRole('button', { name: 'Buscar' })).toHaveCount(0)
    await expect(bar.getByRole('link', { name: 'Favoritos' })).toHaveCount(0)
    await expect(bar.getByRole('link', { name: /vecindario/i })).toHaveCount(0)

    // FAB points at the publish flow.
    await expect(bar.getByRole('link', { name: 'Vender', exact: true }))
      .toHaveAttribute('href', '/sell')
  })

  test('hides on scroll-down and springs back on scroll-up', async ({ page }) => {
    await gotoWithBarForced(page, '/terminos')

    const bar = page.locator('.pwa-only')
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
    // (independent of the CSS gate — no override needed).
    await expect(page.locator('.pwa-only')).toHaveCount(0)
  })
})
