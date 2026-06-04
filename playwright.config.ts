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
 * Vercel previews are SSO-gated (401 to anonymous requests). To reach a preview
 * before merge, set VERCEL_AUTOMATION_BYPASS_SECRET — the project's "Protection
 * Bypass for Automation" secret — and it's sent as the `x-vercel-protection-bypass`
 * header on every request. Never hardcode it; CI injects it from a GitHub secret.
 *
 * Grow coverage one spec per new browser/API-testable story (see
 * Roadmap/WAYS-OF-WORKING.md → Automated QA).
 */
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://miyagisanchez.com',
    extraHTTPHeaders: {
      Accept: 'application/json',
      // Bypass Vercel Deployment Protection on SSO-gated previews (no-op on prod).
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
  },
})
