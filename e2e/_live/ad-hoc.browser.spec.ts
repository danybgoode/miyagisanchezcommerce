import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { authEnabled, buyerEmail, sellerEmail, adminEmail, signIn } from '../_helpers/auth'

/**
 * Live-smoke ad-hoc runner (`scripts/live-smoke.mjs`'s `--path` mode).
 *
 * A single, parametrized spec driven entirely by env vars — never a permanent
 * regression check itself. For a shipped story's permanent coverage, write a
 * real `e2e/<name>.browser.spec.ts` and run it via `--spec` instead (see
 * `skills/live-smoke/SKILL.md`).
 *
 *   LIVE_SMOKE_PATH   — required. The path to navigate (e.g. /vende/migracion).
 *   LIVE_SMOKE_FLOW   — 'unauthed' | 'buyer' | 'seller' | 'admin' (default 'unauthed').
 *   LIVE_SMOKE_OUT    — output dir for report.json + screenshot.png
 *                       (default test-results/live-smoke).
 *
 * Writes a structured JSON report + a full-page screenshot BEFORE any
 * assertion can throw, so the calling script always has something to read
 * back — a failed assertion still leaves evidence on disk, not just a
 * Playwright stack trace.
 */

const FLOWS = ['unauthed', 'buyer', 'seller', 'admin'] as const
type Flow = (typeof FLOWS)[number]

function resolveFlow(): Flow {
  const raw = process.env.LIVE_SMOKE_FLOW ?? 'unauthed'
  return (FLOWS as readonly string[]).includes(raw) ? (raw as Flow) : 'unauthed'
}

function emailForFlow(flow: Flow): string | null {
  if (flow === 'buyer') return buyerEmail()
  if (flow === 'seller') return sellerEmail()
  if (flow === 'admin') return adminEmail()
  return null
}

type LiveSmokeReport = {
  path: string
  flow: Flow
  baseURL: string | undefined
  httpStatus: number | null
  ok: boolean
  title: string | null
  consoleErrors: string[]
  screenshot: string | null
  timestamp: string
}

test.describe('live smoke · ad hoc', () => {
  test('navigate + capture', async ({ page, baseURL }) => {
    const path = process.env.LIVE_SMOKE_PATH
    test.skip(!path, 'Set LIVE_SMOKE_PATH to the route this run should smoke.')
    const flow = resolveFlow()
    const outDir = process.env.LIVE_SMOKE_OUT ?? 'test-results/live-smoke'
    mkdirSync(outDir, { recursive: true })

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

    if (flow !== 'unauthed') {
      test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) for an authed live smoke.')
      const email = emailForFlow(flow)
      test.skip(!email, `Set the MS_TEST_* email for flow "${flow}" to run an authed live smoke.`)
      await signIn(page, email as string)
    }

    let httpStatus: number | null = null
    let ok = false
    let title: string | null = null
    let screenshotPath: string | null = null

    try {
      const res = await page.goto(path as string)
      httpStatus = res?.status() ?? null
      ok = res?.ok() ?? false
      title = await page.title()
      screenshotPath = `${outDir}/screenshot.png`
      await page.screenshot({ path: screenshotPath, fullPage: true })
    } finally {
      const report: LiveSmokeReport = {
        path: path as string,
        flow,
        baseURL,
        httpStatus,
        ok,
        title,
        consoleErrors,
        screenshot: screenshotPath,
        timestamp: new Date().toISOString(),
      }
      writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2))
    }

    expect(ok, `GET ${path} did not return 2xx (got ${httpStatus})`).toBeTruthy()
    await expect(page.locator('body')).not.toBeEmpty()
  })
})
