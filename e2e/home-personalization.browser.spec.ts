import { test, expect } from '@playwright/test'
import { buyerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Marketplace static-shell — Sprint 4 (Story 4.2). The personalization islands are a
 * client-only progressive enhancement: only a real browser sees whether they hydrate
 * (signed-in) or stay absent (anonymous). This is the no-regression guarantee.
 *
 * Two layers:
 *  • ANONYMOUS — always runs. Proves the islands no-op without a session, so the static
 *    homepage is byte-unchanged for signed-out/loading visitors (mirrors the
 *    `home-static` api guardrail, but in a real browser after hydration settles).
 *  • SIGNED-IN — fixture-gated (MS_TEST_BROWSER_AUTH=1 + MS_TEST_BUYER_EMAIL, dev/preview
 *    only). Signs in, loads `/`, and asserts the island container reacts. CAVEAT: the S3
 *    endpoint's CORS allows the prod origin only, so on a dev preview the cross-origin
 *    fetch is blocked and the islands degrade to nothing — i.e. this can only positively
 *    confirm hydration on prod. The real signed-in eyeball is therefore owed to Daniel
 *    on prod (the test stays informative: it never reports a false pass).
 */

const MODULE_IDS = [
  'home-retoma-rail',
  'home-offer-alert',
  'home-seller-snapshot',
  'home-seller-recruit',
] as const

test.describe('home-personalization · islands (browser)', () => {
  test('anonymous: no personalization module renders on the static homepage', async ({ page }) => {
    await page.goto('/')
    // Let client hydration settle — the islands mount client-side, then no-op (no session).
    await page.waitForLoadState('networkidle')
    for (const id of MODULE_IDS) {
      await expect(page.locator(`[data-testid="${id}"]`)).toHaveCount(0)
    }
  })

  test('signed-in: the islands hydrate from the personalization endpoint', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
    const email = requireEnv(buyerEmail(), 'MS_TEST_BUYER_EMAIL')
    await signIn(page, email)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // A signed-in homepage shows exactly one seller module (snapshot XOR recruit) once the
    // island fetch resolves — the deterministic signal independent of the buyer's favorites
    // /offers (which may be empty).
    const sellerModules = page.locator(
      '[data-testid="home-seller-snapshot"], [data-testid="home-seller-recruit"]',
    )

    // STRICT (MS_TEST_PERSONALIZATION_STRICT=1) — run where the endpoint is expected to work
    // (prod origin, valid keys). Requires the island to actually hydrate, so a broken
    // endpoint / token / CORS / provider bug FAILS here. This is the gate for Daniel's prod
    // smoke (codex cross-review should-fix: don't let a broken hydration silently pass).
    if (process.env.MS_TEST_PERSONALIZATION_STRICT === '1') {
      await expect(sellerModules).toHaveCount(1)
      await expect(sellerModules.first()).toBeVisible()
      return
    }

    // DEFAULT (CI/preview) — the S3 endpoint's CORS allows the prod origin only, so on a
    // preview the fetch degrades to nothing. Allow either: a hydrated module, or none — but
    // never a false pass (when present, it's exactly one). Set STRICT on prod to gate it.
    const count = await sellerModules.count()
    expect(count).toBeLessThanOrEqual(1)
    if (count === 1) {
      await expect(sellerModules.first()).toBeVisible()
    }
  })
})
