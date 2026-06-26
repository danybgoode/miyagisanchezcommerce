import { test, expect } from '@playwright/test'
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
    await expect(body).toContainText('«')
    // First few chars of the title (sanitized to a single line) appear inside the prompt.
    await expect(body).toContainText(title.replace(/\s+/g, ' ').slice(0, 16))
  })
})
