import { clerkSetup } from '@clerk/testing/playwright'

/**
 * Playwright globalSetup — runs once in the main process before workers fork, so
 * the CLERK_TESTING_TOKEN that clerkSetup() writes to process.env is inherited by
 * every worker (a setup *project* runs in a worker and wouldn't propagate it).
 *
 * No-op unless authed browser smokes are enabled AND the Clerk keys are present —
 * so the API gate (no keys) and anonymous browser smokes are unaffected. Clerk
 * rejects testing tokens for production secret keys, so this only ever runs with a
 * dev/test instance key (against a Vercel preview).
 */
export default async function globalSetup(): Promise<void> {
  if (
    process.env.MS_TEST_BROWSER_AUTH === '1' &&
    process.env.CLERK_SECRET_KEY &&
    process.env.CLERK_PUBLISHABLE_KEY
  ) {
    await clerkSetup({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY })
  }
}
