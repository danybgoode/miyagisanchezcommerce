import { expect, test } from '@playwright/test'

// Sprint 4 — US-5 mobile-responsive sweep. Asserts what the no-browser `api` gate structurally
// cannot: horizontal layout overflow is a rendered fact (document.documentElement.scrollWidth vs
// clientWidth). Opt-in browser project (NOT the blocking gate): `npm run test:e2e:browser`, nightly
// via browser-smoke.yml. Real-device nuances (font scaling, on-screen-keyboard viewport, safe-area
// insets) still evade headless viewport checks and stay owed to Daniel (see sprint-4.md walkthrough).

const PAGES = ['/vende', '/vende/creadores', '/vende/negocios', '/vende/servicios', '/vende/mundial']
const WIDTHS = [360, 390, 414]

test.describe('seller acquisition · mobile no-overflow sweep (browser)', () => {
  for (const path of PAGES) {
    for (const width of WIDTHS) {
      test(`${path} fits ${width}px with no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 })
        const res = await page.goto(path)
        expect(res?.ok()).toBeTruthy()

        // The hero heading renders and is not clipped off-screen.
        const h1 = page.getByRole('heading', { level: 1 }).first()
        await expect(h1).toBeVisible()

        // No horizontal page overflow. The benchmark table may scroll inside its own card, but the
        // document itself must not exceed the viewport width.
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement
          return doc.scrollWidth - doc.clientWidth
        })
        expect(overflow, `no horizontal page overflow on ${width}px`).toBeLessThanOrEqual(1)
      })
    }
  }
})
