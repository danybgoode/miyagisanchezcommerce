import { test, expect } from '@playwright/test'
import { buyerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * Buyer notifications money-path (epic 05), Sprint 2.3 — grid unlock.
 *
 * Asserts the buyer preference center actually RENDERS Compras × Push/Telegram as
 * live (non-disabled) toggles, not the "pronto" placeholder — a rendered-DOM claim
 * the `api` project can't observe (no browser). Compras × Email stays disabled
 * (the forced receipt). Authed browser smoke: runs against a dev/preview via
 * @clerk/testing ticket sign-in and **skips gracefully** when the credentials
 * aren't set. Enable with MS_TEST_BROWSER_AUTH=1 + dev Clerk keys +
 * MS_TEST_BUYER_EMAIL.
 */

test.describe('buyer notifications · Compras grid unlock (browser)', () => {
  test('Compras × Push/Telegram are live toggles; Compras × Email stays locked (S2.3)', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
    const email = requireEnv(buyerEmail(), 'MS_TEST_BUYER_EMAIL')

    await signIn(page, email)
    await page.goto('/account/notificaciones')

    const emailSwitch = page.getByRole('switch', { name: 'Compras · Email' })
    const pushSwitch = page.getByRole('switch', { name: 'Compras · Push' })
    const telegramSwitch = page.getByRole('switch', { name: 'Compras · Telegram' })

    await expect(emailSwitch).toBeVisible()
    await expect(emailSwitch).toBeDisabled() // forced-on receipt, never togglable
    await expect(pushSwitch).toBeEnabled()

    // Telegram is only live once linked — assert it isn't hard-locked to Compras
    // specifically (every other group's telegram cell shares the same linked-gate,
    // so if the account is linked this is enabled too; if not, it's disabled for
    // every group identically — either way, no Compras-only special case).
    const envioTelegramSwitch = page.getByRole('switch', { name: 'Envíos · Telegram' })
    expect(await telegramSwitch.isDisabled()).toBe(await envioTelegramSwitch.isDisabled())

    // The old "pronto" placeholder text must be gone from the Compras row entirely.
    const comprasRow = page.locator('tr', { has: page.getByText('Compras', { exact: true }) })
    await expect(comprasRow.getByText('pronto')).toHaveCount(0)
  })
})
