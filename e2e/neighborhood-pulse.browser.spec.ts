import { expect, test } from '@playwright/test'
import { NEIGHBORHOOD_PULSE_COPY } from '../lib/neighborhood-pulse'

test.describe('neighborhood pulse · anonymous browser smoke', () => {
  test('feed and contribution CTA render without login', async ({ page }) => {
    await page.goto('/vecindario')

    await expect(page.getByRole('heading', { name: NEIGHBORHOOD_PULSE_COPY.title, level: 1 })).toBeVisible()
    const cta = page.getByRole('link', { name: NEIGHBORHOOD_PULSE_COPY.contributeCta }).first()
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute('href', '/comunidad/nuevo')
  })
})
