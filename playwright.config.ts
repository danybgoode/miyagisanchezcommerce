import { defineConfig } from '@playwright/test'

/**
 * Minimal Playwright harness — seeded by epic 07 (Agent Connection).
 *
 * Specs hit public endpoints on a running deploy (no local stack, no browser
 * binaries — the API-level `request` fixture is enough). Point at any
 * environment with PLAYWRIGHT_BASE_URL; defaults to production.
 *
 *   npx playwright test
 *   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app npx playwright test
 *
 * Grow coverage one spec per new browser/API-testable story (see
 * Roadmap/WAYS-OF-WORKING.md → Automated QA).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://miyagisanchez.com',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
})
