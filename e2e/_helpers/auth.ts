import { test, type Page } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'

/**
 * Authed browser smokes via @clerk/testing.
 *
 * Sign-in is **ticket-based** (`clerk.signIn({ page, emailAddress })`): it mints a
 * one-time sign-in token through Clerk's Backend API and uses the `ticket` strategy,
 * bypassing password / email-code / 2FA entirely. No password needed — only the
 * user's email + `CLERK_SECRET_KEY`.
 *
 * **Dev/test instance only.** Clerk's testing token (which bypasses bot protection)
 * is rejected for production secret keys by design, so these run against the **dev**
 * Clerk instance — i.e. a **Vercel preview**, not prod. `e2e/global.setup.ts` arms
 * the testing token; this helper assumes it ran.
 *
 * Provision (done): dev-instance users `MS_TEST_BUYER_EMAIL` / `MS_TEST_SELLER_EMAIL`.
 * Master switch: `MS_TEST_BROWSER_AUTH=1` (+ `CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY`).
 */

export function buyerEmail(): string | null {
  return process.env.MS_TEST_BUYER_EMAIL || null
}

export function sellerEmail(): string | null {
  return process.env.MS_TEST_SELLER_EMAIL || null
}

/** Authed smokes are off unless explicitly enabled (and only against a dev/preview). */
export function authEnabled(): boolean {
  return process.env.MS_TEST_BROWSER_AUTH === '1'
}

/** Skip the current test when a fixture is missing — with a clear reason. */
export function requireEnv<T>(value: T | null | undefined, what: string): T {
  test.skip(value == null || value === '', `Set ${what} to run this browser smoke.`)
  return value as T
}

/** Ticket-based sign-in. Call after the page can load Clerk (we navigate to '/'). */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/')
  await clerk.signIn({ page, emailAddress: email })
}
