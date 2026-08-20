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
  reporter: [
    ['list'],
    ['./e2e/reporters/fixture-skip-reporter.ts'],
  ],
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
        // es-MX is the DEFAULT BROWSER LANGUAGE for the whole browser suite, because
        // it is the platform's canonical locale (AGENTS.md rule 5) — and because since
        // `one-landing-per-market` (#399) the browser's language is load-bearing on
        // every surface that can reach `/`.
        //
        // `RootLanguageSwitch` hops a visitor whose `navigator.languages` prefers
        // English from `/` to `/en` after hydration. Playwright's default locale is
        // `en-US`, so every spec that lands on the root — directly, or by being
        // redirected there from an auth-gated page — silently began testing the
        // English document. It broke two specs whose subject is not language at all:
        // `market-selector` (asserts `/` stays `/`) and `admin-seleccion` (asserts an
        // anonymous visitor is turned away from `/admin/...`, which lands them on the
        // root and then hopped them to `/en`). Five more specs `goto('/')` and were
        // one assertion away from the same fate.
        //
        // Setting it here rather than per-spec is the point: this is a property of the
        // MARKET the suite is testing, not of any one spec, and fixing it one file at a
        // time is how four `/vende` call sites got found by hand one at a time. Any
        // spec that genuinely tests English opts in with `test.use({ locale: 'en-US' })`
        // — `root-language-hop.browser.spec.ts` does exactly that, so the hop stays
        // covered and this default cannot hide a regression in it.
        locale: 'es-MX',

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
