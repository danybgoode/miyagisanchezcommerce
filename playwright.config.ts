import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright harness — seeded by epic 07 (Agent Connection), extended with an
 * opt-in browser layer.
 *
 * THREE projects:
 *   • `api`     — the deterministic gate. API-level specs (`*.spec.ts`, excluding
 *                 `*.browser.spec.ts` and `*.staging.spec.ts`) hit public endpoints via
 *                 the `request` fixture against `baseURL`. No browser binaries → fast,
 *                 cheap, runs in CI on every PR.
 *   • `browser` — opt-in real-browser smoke (`*.browser.spec.ts`, Chromium). Asserts
 *                 *rendered* UI an API call can't see (a field renders before the CTA,
 *                 a counter ticks, a required-field nudge fires). NOT in the blocking
 *                 gate (binaries are heavy/slow); run on demand / nightly.
 *   • `staging` — opt-in, targets a DIFFERENT host than `baseURL` on purpose (e.g. an
 *                 infra-migration staging hostname like `gcp.miyagisanchez.com` — see
 *                 09-platform-infra/frontend-vercel-to-cloudrun). Excluded from `api`
 *                 for exactly that reason: included there, it would run against the PR's
 *                 Vercel preview and fail on a host mismatch that isn't a real bug (this
 *                 happened live — CI caught two specs that were named plain `*.spec.ts`
 *                 and got swept into the gate). Run explicitly with
 *                 `PLAYWRIGHT_BASE_URL=<target> npx playwright test --project=staging`.
 *
 *   npx playwright test                      # api + browser (needs `playwright install`)
 *   npm run test:e2e                         # api only — the gate
 *   npm run test:e2e:browser                 # browser only (run `npx playwright install chromium` first)
 *   PLAYWRIGHT_BASE_URL=<url> npx playwright test --project=staging   # staging only, explicit host
 *
 * Point at any environment with PLAYWRIGHT_BASE_URL; defaults to production.
 *
 * Vercel previews are SSO-gated (401 to anonymous requests). Set
 * VERCEL_AUTOMATION_BYPASS_SECRET — the project's "Protection Bypass for Automation"
 * secret — and it's sent as the `x-vercel-protection-bypass` header / cookie on every
 * request. Never hardcode it; CI injects it from a GitHub secret.
 *
 * Authed browser smokes read MS_TEST_* credentials (see e2e/_helpers/auth.ts) and
 * skip gracefully when they're absent — so the harness is safe to run anywhere.
 *
 * Grow coverage one spec per new browser/API-testable story (see
 * Roadmap/WAYS-OF-WORKING.md → Automated QA and Roadmap/LEARNINGS.md).
 */
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://miyagisanchez.com'

export default defineConfig({
  testDir: './e2e',
  // Arms the Clerk testing token for authed browser smokes (no-op without the
  // Clerk keys + MS_TEST_BROWSER_AUTH, so the API gate is unaffected).
  globalSetup: './e2e/global.setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    extraHTTPHeaders: {
      Accept: 'application/json',
      // Bypass Vercel Deployment Protection on SSO-gated previews (no-op on prod).
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
  },
  projects: [
    {
      name: 'api',
      testIgnore: ['**/*.browser.spec.ts', '**/*.staging.spec.ts'],
    },
    {
      name: 'browser',
      testMatch: '**/*.browser.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Real browser reaching an SSO-gated preview — send the bypass token as a
        // header (Playwright also persists it so the protection cookie is set).
        extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
      },
    },
    {
      // Plain request-fixture specs, same as `api`, but pointed at a deliberately
      // different host — never picked up by `api` or run in CI (see header comment).
      name: 'staging',
      testMatch: '**/*.staging.spec.ts',
    },
  ],
})
