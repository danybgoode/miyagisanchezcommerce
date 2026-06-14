import { test, expect } from '@playwright/test'
import { buyerEmail, authEnabled, requireEnv, signIn } from './_helpers/auth'

/**
 * S3.1 — Visibility-gated unread-badge poll (Vercel function & Fluid-CPU cost
 * reduction, Sprint 3).
 *
 * The global unread badge (`MobileTabBar` + `DesktopUnreadBadge`, both layout-level
 * chrome) polls `/api/conversations/unread` on an interval. Sprint 3 makes that poll
 * fire **only while the tab is visible** and refetch on return, so a backgrounded tab
 * stops billing a function invocation. This asserts the gate directly — no need to
 * wait the 150s interval.
 *
 * The poll only runs for a **signed-in** session (the effect early-returns when
 * signed out), so this is an authed browser smoke: it runs against a dev/preview via
 * @clerk/testing ticket sign-in and **skips gracefully** when the credentials aren't
 * set. Enable with MS_TEST_BROWSER_AUTH=1 + dev Clerk keys + MS_TEST_BUYER_EMAIL.
 *
 * `display-mode: standalone` isn't emulatable, but document **visibility** is — a
 * mutable window flag backs `document.visibilityState`/`hidden` (installed via
 * addInitScript before the badge mounts) so we can flip the tab foreground/background
 * in-page and observe whether the poll fires. The live DevTools eyeball stays owed
 * to Daniel.
 */
const UNREAD = '/api/conversations/unread'

test.describe('unread badge poll · visibility-gated (browser)', () => {
  test('no poll while the tab is hidden; fires on return to visible (S3.1)', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run authed browser smokes.')
    const email = requireEnv(buyerEmail(), 'MS_TEST_BUYER_EMAIL')

    await signIn(page, email)

    // Emulate a backgrounded tab BEFORE the badge components mount: a mutable flag
    // backs document.visibilityState/hidden so we can flip it later in-page.
    await page.addInitScript(() => {
      ;(window as unknown as { __vis: string }).__vis = 'hidden'
      Object.defineProperty(document, 'visibilityState', {
        configurable: true, get: () => (window as unknown as { __vis: string }).__vis,
      })
      Object.defineProperty(document, 'hidden', {
        configurable: true, get: () => (window as unknown as { __vis: string }).__vis !== 'visible',
      })
    })

    const unreadHits: number[] = []
    page.on('request', (r) => { if (r.url().includes(UNREAD)) unreadHits.push(Date.now()) })

    // Mount the layout (tab bar + desktop badge both poll) under the hidden tab.
    await page.goto('/')
    // Give the mount-time checkUnread() ample time to (not) fire.
    await page.waitForTimeout(3000)
    expect(unreadHits, 'no unread poll should fire while document is hidden').toHaveLength(0)

    // Return to the foreground → the visibilitychange handler refetches immediately.
    const fired = page.waitForRequest((r) => r.url().includes(UNREAD), { timeout: 10_000 })
    await page.evaluate(() => {
      ;(window as unknown as { __vis: string }).__vis = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await fired
    expect(unreadHits.length).toBeGreaterThan(0)
  })
})
