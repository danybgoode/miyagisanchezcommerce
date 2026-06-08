import { test, expect } from '@playwright/test'

/**
 * Discovery Polish · Sprint 1 — type chip rail (S1.2) + card type badge (S1.3),
 * real-browser, ANONYMOUS (no auth). Closes the gap the API harness can't see:
 * the chip is a client-navigated link and the badge is rendered markup.
 *
 * Data-resilient: the URL + selected-state assertions always hold; the "Servicio"
 * badge is asserted only when service listings actually render (else the valid
 * "Sin resultados" empty state proves the filter still applied).
 *
 * Chips are targeted by href (`listing_type=service`) — "Servicios" also exists as
 * a category chip, so text alone would be ambiguous.
 */
test.describe('discovery · type filter (browser)', () => {
  test('tapping the Servicios type chip filters by listing_type=service (S1.2)', async ({ page }) => {
    await page.goto('/l')

    const serviceChip = page.locator('a.chip[href*="listing_type=service"]')
    await expect(serviceChip).toBeVisible()
    await serviceChip.click()

    // The filter round-trips into the URL.
    await expect(page).toHaveURL(/listing_type=service/)
    // …and the chip reads as selected after the navigation.
    await expect(page.locator('a.chip.is-selected[href*="listing_type=service"]')).toBeVisible()
  })

  test('service results carry a "Servicio" badge, else a valid empty state (S1.3)', async ({ page }) => {
    await page.goto('/l?listing_type=service')

    const badge = page.getByText('Servicio', { exact: true }).first()
    const empty = page.getByText('Sin resultados')
    // Either: service cards render (each with the type badge), or no service
    // listing exists right now (empty state) — both prove the filter applied.
    await expect(badge.or(empty)).toBeVisible()
  })
})
