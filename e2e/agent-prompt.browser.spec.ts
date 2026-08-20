import { test, expect } from '@playwright/test'
import { onVercelPreview, CLIENT_JS_UNAVAILABLE_ON_PREVIEW } from './_helpers/target'
import { requireEnv } from './_helpers/auth'

/**
 * Contextual agent hand-off — real-browser render smoke, ANONYMOUS (no auth).
 * Closes the gap the `api` spec can't reach: the navbar "Compra con tu agente IA"
 * card is a client portal sheet, and the rich product details flow through a client
 * AgentContext island (SetAgentContext) that only runs in a real browser. The pure
 * builder is covered in `agent-prompt.spec.ts`; this proves the plumbing engages
 * end-to-end — the copied prompt actually NAMES the product (S2.2).
 *
 * Fixture: MS_TEST_PDP_LISTING_ID — any PUBLIC listing. Skips cleanly when unset
 * (nightly `browser-smoke.yml` provides it). Shop + authed-order round-trips stay
 * owed to Daniel.
 */
const LISTING_ID = process.env.MS_TEST_PDP_LISTING_ID || process.env.MS_TEST_PERSONALIZED_LISTING_ID

test.describe('agent hand-off card · PDP names the product (browser)', () => {
  test('opening the card on a PDP yields a prompt that names the product + URL', async ({ page }) => {
    // Same 30s-budget problem as the sibling in this PR: a full PDP navigation
    // against production, where `page.goto` waits for `load` and therefore for
    // every image on the page. It timed out in the same 2026-08-10 nightly run
    // (all three failures that night were `Test timeout of 30000ms exceeded`;
    // not one was an assertion failure) and the draft that became this PR
    // dismissed it as "flaky, no action needed" — five days before its
    // neighbours went genuinely red for the same reason.
    //
    // Deliberately NOT applied to `pdp-gallery.browser.spec.ts`, which timed out
    // in that run too: its real cause was found and fixed in #370 — fixture
    // discovery was picking a ten-image PDP, and taking the cheapest qualifying
    // listing instead took that file from 31s to 8s. A timeout with a known,
    // fixed cause does not want a bigger budget; this one, whose fixture is a
    // pinned env id we do not choose, still does.
    test.slow()

    requireEnv(LISTING_ID, 'MS_TEST_PDP_LISTING_ID')
    await page.goto(`/l/${LISTING_ID}`)

    // The product title is the PDP's h1.
    const title = (await page.locator('h1').first().innerText()).trim()
    test.skip(!title, 'listing has no title to assert')

    // Open the agent card (the single labeled entry; mobile + desktop share the sheet).
    await page.getByRole('button', { name: 'Agente IA' }).first().click()

    // The sheet (a body portal) is open once its copy action shows.
    await expect(page.getByRole('button', { name: /Copiar prompt/ })).toBeVisible()

    // The prompt must carry the canonical product URL and the product name in guillemets
    // (rich mode engaged via AgentContext, not the URL-only Sprint-1 fallback).
    const body = page.locator('body')
    await expect(body).toContainText(`/l/${LISTING_ID}`)

    // Rich mode is client-side, and a Vercel preview cannot get there: its own
    // `x-vercel-protection-bypass` header CORS-blocks clerk-js, and the card degrades
    // to exactly the URL-only Sprint-1 fallback named above. The tell is that the
    // assertion immediately ABOVE — the canonical URL — passes on the same run; the
    // card is not broken, the environment cannot show its rich half. Verified passing
    // against production with a real fixture. See e2e/_helpers/target.ts.
    test.skip(onVercelPreview(), CLIENT_JS_UNAVAILABLE_ON_PREVIEW)

    await expect(body).toContainText('«')
    // First few chars of the title (sanitized to a single line) appear inside the prompt.
    await expect(body).toContainText(title.replace(/\s+/g, ' ').slice(0, 16))
  })
})
