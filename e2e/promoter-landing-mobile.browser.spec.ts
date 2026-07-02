import { expect, test } from '@playwright/test'

// promoter-funnel-v2 · Sprint 1 · Sprint QA — mobile-responsive sweep on the reworked promoter
// landing + handbook. Mirrors e2e/seller-acquisition-mobile.browser.spec.ts's pattern: asserts what
// the no-browser `api` gate structurally cannot (document.documentElement.scrollWidth vs
// clientWidth is only a fact in a real layout). Opt-in browser project (NOT the blocking gate):
// `npm run test:e2e:browser`, nightly via browser-smoke.yml. Real-device nuances (font scaling,
// on-screen-keyboard viewport, safe-area insets) stay owed to Daniel.

const PAGES = ['/vende/promotor', '/vende/promotor/sell-sheet']
const WIDTHS = [360, 390, 414]

test.describe('promoter landing · mobile no-overflow sweep (browser)', () => {
  for (const path of PAGES) {
    for (const width of WIDTHS) {
      test(`${path} fits ${width}px with no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 })
        const res = await page.goto(path)
        expect(res?.ok()).toBeTruthy()

        const h1 = page.getByRole('heading', { level: 1 }).first()
        await expect(h1).toBeVisible()

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement
          return doc.scrollWidth - doc.clientWidth
        })
        expect(overflow, `no horizontal page overflow on ${width}px`).toBeLessThanOrEqual(1)
      })
    }
  }

  test('/vende/promotor shows the copy-paste prompt button at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 844 })
    const res = await page.goto('/vende/promotor')
    expect(res?.ok()).toBeTruthy()
    await expect(page.getByRole('button', { name: /Copiar prompt para mi IA/i }).first()).toBeVisible()
  })
})
