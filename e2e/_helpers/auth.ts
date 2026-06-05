import { test, type Page } from '@playwright/test'

/**
 * Test-credential helpers for authed browser smokes.
 *
 * The high-value money-path smokes (buy a product, see the seller order screen)
 * are Clerk-authed — a headless agent can't reach them without a real test login.
 * We read credentials from env and **skip gracefully** when they're absent, so the
 * harness is safe to run anywhere (locally, CI, an agent's machine).
 *
 * Provision (Daniel): two disposable Clerk accounts with **password** auth enabled
 * (not OTP-only) on a test shop. Set as env / CI secrets:
 *   MS_TEST_BUYER_EMAIL   / MS_TEST_BUYER_PASSWORD
 *   MS_TEST_SELLER_EMAIL  / MS_TEST_SELLER_PASSWORD
 * Optional fixtures for epic-specific smokes:
 *   MS_TEST_LISTING_ID            — a PUBLIC listing id for render smokes
 *   MS_TEST_PERSONALIZED_LISTING_ID — a listing that has custom personalization fields
 */

export interface Creds { email: string; password: string }

export function buyerCreds(): Creds | null {
  const email = process.env.MS_TEST_BUYER_EMAIL
  const password = process.env.MS_TEST_BUYER_PASSWORD
  return email && password ? { email, password } : null
}

export function sellerCreds(): Creds | null {
  const email = process.env.MS_TEST_SELLER_EMAIL
  const password = process.env.MS_TEST_SELLER_PASSWORD
  return email && password ? { email, password } : null
}

/**
 * Authed browser smokes are OFF by default. The production Clerk instance is
 * email-code/OAuth-first (password is enabled but the UI routes to an email-code
 * second factor), so a headless password sign-in can't complete unaided. Turning
 * these on needs the Clerk testing-token setup (@clerk/testing) + the prod Clerk
 * keys in CI — a security decision. Once wired, opt in with MS_TEST_BROWSER_AUTH=1.
 */
export function authEnabled(): boolean {
  return process.env.MS_TEST_BROWSER_AUTH === '1'
}

/** Skip the current test/describe when an env fixture is missing — with a clear reason. */
export function requireEnv<T>(value: T | null | undefined, what: string): T {
  test.skip(value == null || value === '', `Set ${what} to run this browser smoke.`)
  return value as T
}

/**
 * Sign in through Clerk's `<SignIn>` component with email + password.
 *
 * Critical: click Clerk's **primary form button** (`.cl-formButtonPrimary`), NOT any
 * button whose text matches /continue|continuar/ — the first screen also has a
 * "Continuar con Google" social button, and matching on text walks into Google OAuth.
 * Selectors use Clerk's stable `cl-*` classes / field names.
 */
export async function signIn(page: Page, creds: Creds): Promise<void> {
  await page.goto('/sign-in')
  // Step 1 — identifier, then the form's own submit (not a social/OAuth button).
  const email = page.locator('input[name="identifier"]').first()
  await email.waitFor({ state: 'visible', timeout: 15_000 })
  await email.fill(creds.email)
  await page.locator('.cl-formButtonPrimary').first().click()
  // Step 2 — the password field becomes enabled on the password step.
  const password = page.locator('input[name="password"]:not([disabled])').first()
  await password.waitFor({ state: 'visible', timeout: 15_000 })
  await password.fill(creds.password)
  await page.locator('.cl-formButtonPrimary').first().click()
  // Landed back in the app (Clerk redirects away from /sign-in on success).
  await page.waitForURL(url => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 })
}
