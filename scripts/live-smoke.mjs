#!/usr/bin/env node
/**
 * live-smoke — the scripted, cross-agent-usable default for verifying real,
 * rendered behavior against local/preview/staging/prod, unauthed or authed.
 *
 * Wraps the existing Playwright harness (`playwright.config.ts`'s `browser`
 * project + `e2e/_helpers/auth.ts`'s Clerk ticket sign-in) — no new
 * browser-driving logic, just env resolution + a structured result an agent
 * can parse without reading raw Playwright output.
 *
 * Two modes:
 *   --path <url-path> [--flow unauthed|buyer|seller|admin]
 *       Ad-hoc: runs e2e/_live/ad-hoc.browser.spec.ts against ONE path.
 *       Nothing permanent is left behind — for active-development "does this
 *       look right" checks.
 *   --spec <name>
 *       Runs an existing, COMMITTED e2e/*.browser.spec.ts whose TEST TITLE
 *       matches <name> (playwright test -g <name> — a substring/regex match
 *       against the test's title, NOT its filename). Use this for a shipped
 *       story's permanent regression coverage (write the spec first, then
 *       run it this way).
 *
 * Environments (--env):
 *   local    http://localhost:3001 (assumes `npm run dev` or the standalone
 *            server is already running — this script does not start one)
 *   preview  requires --preview-url; injects VERCEL_AUTOMATION_BYPASS_SECRET
 *   staging  the GCP migration-staging host
 *   prod     https://miyagisanchez.com (default)
 *
 * For any --flow other than unauthed, also requires MS_TEST_BROWSER_AUTH=1 +
 * the dev Clerk keys + the relevant MS_TEST_*_EMAIL to be resolvable from
 * .env.local (never printed) — see skills/live-smoke/SKILL.md's Gotchas.
 *
 * Output: exit code (0 = pass), a JSON report at
 * test-results/live-smoke/report.json, a screenshot at
 * test-results/live-smoke/screenshot.png. Read both back — don't just trust
 * the exit code for an ad-hoc run (a 0 with an unexpected screenshot is
 * still worth flagging).
 *
 * Examples:
 *   node scripts/live-smoke.mjs --env=prod  --flow=unauthed --path=/vende/migracion
 *   node scripts/live-smoke.mjs --env=local --flow=admin    --path=/admin/promoter
 *   node scripts/live-smoke.mjs --env=local --spec="buyer can sign in"
 */
import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = process.env.LIVE_SMOKE_OUT ?? 'test-results/live-smoke'

const ENV_BASE_URLS = {
  local: 'http://localhost:3001',
  staging: process.env.LIVE_SMOKE_STAGING_URL ?? 'https://gcp.miyagisanchez.com',
  prod: 'https://miyagisanchez.com',
}

function die(message) {
  console.error(`live-smoke: ${message}`)
  process.exit(2)
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      env: { type: 'string', default: 'prod' },
      flow: { type: 'string', default: 'unauthed' },
      path: { type: 'string' },
      spec: { type: 'string' },
      'preview-url': { type: 'string' },
    },
  })
  return values
}

/** Strip a matching pair of surrounding quotes (single or double), if present. */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * Load .env.local key/values without printing them or mutating process.env
 * globally. Handles a leading `export ` prefix and quoted values (both
 * common in a hand-edited .env.local) — a plain `KEY=value` parse would
 * otherwise pass a literal `"sk_test_..."` (quotes included) into Clerk and
 * fail auth with a confusing error, not the intended value.
 */
function loadDotEnvLocal() {
  const path = join(APP_ROOT, '.env.local')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    let trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice('export '.length).trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = unquote(trimmed.slice(eq + 1).trim())
    out[key] = value
  }
  return out
}

function resolveBaseURL(env, previewUrl) {
  if (env === 'preview') {
    if (!previewUrl) die('--env=preview requires --preview-url=<https://...vercel.app>')
    return previewUrl
  }
  const url = ENV_BASE_URLS[env]
  if (!url) die(`unknown --env "${env}" (expected local|preview|staging|prod)`)
  return url
}

function main() {
  const args = parseCliArgs()
  const flow = args.flow
  if (!['unauthed', 'buyer', 'seller', 'admin'].includes(flow)) {
    die(`--flow must be one of unauthed|buyer|seller|admin (got "${flow}")`)
  }
  if (!args.path && !args.spec) die('pass --path=<url-path> (ad-hoc) or --spec=<name> (a committed spec)')
  if (args.path && args.spec) die('pass --path OR --spec, not both')

  const baseURL = resolveBaseURL(args.env, args['preview-url'])
  const dotenv = loadDotEnvLocal()

  const childEnv = { ...process.env, PLAYWRIGHT_BASE_URL: baseURL }

  if (args.env === 'preview') {
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    if (!bypass) die('--env=preview needs VERCEL_AUTOMATION_BYPASS_SECRET set in the shell environment')
    childEnv.VERCEL_AUTOMATION_BYPASS_SECRET = bypass
  }

  if (flow !== 'unauthed') {
    // Check the URL constraint FIRST — a clear, specific die() beats a
    // generic "need Clerk keys" message when both are true at once (this
    // repo's own default .env.local has no keys AND prod is unsupported).
    if (baseURL === ENV_BASE_URLS.prod) {
      die(
        `--flow=${flow} against --env=prod is not supported — Clerk rejects testing tokens for ` +
          'production secret keys by design. Use --env=local for authed flows, or fall back to ' +
          'Claude-in-Chrome for a real prod-authed check.',
      )
    }

    const clerkPk = process.env.CLERK_PUBLISHABLE_KEY ?? dotenv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    const clerkSk = process.env.CLERK_SECRET_KEY ?? dotenv.CLERK_SECRET_KEY
    if (!clerkPk || !clerkSk) {
      die('an authed --flow needs CLERK_PUBLISHABLE_KEY/CLERK_SECRET_KEY (dev instance) resolvable from the shell or .env.local')
    }
    // Defense-in-depth beyond the URL check above: the SAME "Clerk rejects
    // testing tokens for prod keys" failure can occur even at --env=local if
    // .env.local happens to carry live (`_live_`) keys instead of dev
    // (`_test_`) ones — a real risk flagged in review. Catch it here with a
    // clear message rather than letting Clerk itself fail confusingly deep
    // inside clerk.signIn().
    if (clerkPk.includes('_live_') || clerkSk.includes('_live_')) {
      die(
        'the resolved Clerk keys look like PRODUCTION keys (contain "_live_") — authed live-smoke ' +
          'flows only work with a DEV/TEST Clerk instance (pk_test_.../sk_test_...). Check ' +
          'CLERK_PUBLISHABLE_KEY/CLERK_SECRET_KEY in the shell or .env.local.',
      )
    }
    childEnv.MS_TEST_BROWSER_AUTH = '1'
    childEnv.CLERK_PUBLISHABLE_KEY = clerkPk
    childEnv.CLERK_SECRET_KEY = clerkSk
    for (const key of ['MS_TEST_BUYER_EMAIL', 'MS_TEST_SELLER_EMAIL', 'MS_TEST_ADMIN_EMAIL']) {
      const value = process.env[key] ?? dotenv[key]
      if (value) childEnv[key] = value
    }
  }

  let playwrightArgs
  if (args.path) {
    childEnv.LIVE_SMOKE_PATH = args.path
    childEnv.LIVE_SMOKE_FLOW = flow
    childEnv.LIVE_SMOKE_OUT = OUT_DIR
    // Clear any report/screenshot from a PREVIOUS run before spawning — a
    // skipped or crashed-before-navigating run leaves no fresh report, and
    // without this the readback below would silently pick up stale evidence
    // from an unrelated earlier smoke and report it as if it were current.
    rmSync(join(APP_ROOT, OUT_DIR, 'report.json'), { force: true })
    rmSync(join(APP_ROOT, OUT_DIR, 'screenshot.png'), { force: true })
    playwrightArgs = ['playwright', 'test', '--project=browser', 'e2e/_live/ad-hoc.browser.spec.ts']
  } else {
    playwrightArgs = ['playwright', 'test', '--project=browser', '-g', args.spec]
  }

  console.log(`live-smoke: env=${args.env} baseURL=${baseURL} flow=${flow} ${args.path ? `path=${args.path}` : `spec="${args.spec}"`}`)

  const result = spawnSync('npx', playwrightArgs, {
    cwd: APP_ROOT,
    env: childEnv,
    stdio: 'inherit',
  })

  if (args.path) {
    const reportPath = join(APP_ROOT, OUT_DIR, 'report.json')
    if (existsSync(reportPath)) {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      console.log(`live-smoke: report at ${reportPath}`)
      console.log(`live-smoke: screenshot at ${report.screenshot ? join(APP_ROOT, report.screenshot) : '(none)'}`)
      if (report.consoleErrors?.length) {
        console.log(`live-smoke: ${report.consoleErrors.length} browser console error(s) captured — see report.json`)
      }
    } else {
      console.log('live-smoke: no report.json written (the spec likely skipped or crashed before navigating)')
    }
  }

  process.exit(result.status ?? 1)
}

main()
