import { test, expect } from '@playwright/test'

/**
 * Discovery Polish · Sprint 2 — mobile filter rebuild (S2.1 sheet + S2.2 live
 * count), real-browser, ANONYMOUS (no auth). Closes the gap the API harness
 * can't see: the sheet is a client overlay and the apply button is rendered,
 * live-updating markup.
 *
 * Phone viewport (the sheet/trigger only exist below `sm`). Data-resilient: the
 * trigger/visibility/URL assertions always hold; the count label is asserted by
 * shape (a valid "Ver N resultados" / "Sin resultados"), not an exact number.
 *
 * NOT in the blocking gate. Run against a WARM preview/prod — `/store/listings`
 * is ~90s cold (logged in S1), which the count endpoint shares.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true })

const APPLY = /^(Ver \d+ resultados?|Ver resultados|Sin resultados)$/

test.describe('mobile-filter · bottom-sheet (browser)', () => {
  test('sticky trigger opens the sheet; grid is unobstructed until then (S2.1)', async ({ page }) => {
    await page.goto('/l')

    const trigger = page.getByRole('button', { name: 'Filtrar y ordenar' })
    await expect(trigger).toBeVisible()

    // Closed: the apply button lives in the off-screen sheet — not in viewport.
    const apply = page.getByRole('button', { name: APPLY })
    await expect(apply).not.toBeInViewport()

    await trigger.click()
    // Open: the sheet (and its apply button) slides into the viewport.
    await expect(apply).toBeInViewport()
  })

  test('resizing an open sheet to desktop restores the inline form and body scroll', async ({ page }) => {
    await page.goto('/l')
    await page.getByRole('button', { name: 'Filtrar y ordenar' }).click()

    const form = page.locator('form:has(button[aria-label="Cerrar filtros"])')
    await expect(form).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

    await page.setViewportSize({ width: 800, height: 844 })

    await expect(form).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Buscar' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })

  test('staging a filter updates the count, then apply commits + closes (S2.2)', async ({ page }) => {
    await page.goto('/l')
    await page.getByRole('button', { name: 'Filtrar y ordenar' }).click()

    const apply = page.getByRole('button', { name: APPLY })
    await expect(apply).toBeInViewport()

    // Stage a category without leaving the sheet → the live count re-derives.
    await page.locator('select[name="category"]').selectOption('autos')
    await page.waitForTimeout(700) // debounce (300ms) + count fetch
    await expect(apply).toHaveText(APPLY)

    // Apply commits all staged filters at once and closes the sheet.
    await apply.click()
    await expect(page).toHaveURL(/category=autos/)
    await expect(page.getByRole('button', { name: APPLY })).not.toBeInViewport()
  })

  test('Limpiar resets the staged filters (S2.2)', async ({ page }) => {
    await page.goto('/l?category=autos')
    await page.getByRole('button', { name: 'Filtrar y ordenar' }).click()

    const category = page.locator('select[name="category"]')
    await expect(category).toHaveValue('autos')

    await page.getByRole('button', { name: 'Limpiar' }).click()
    await expect(category).toHaveValue('')
  })
})
