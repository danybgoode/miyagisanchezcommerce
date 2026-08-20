#!/usr/bin/env node
/**
 * smoke-sweep — walks scripts/smoke-sweep.manifest.json, running each entry
 * through scripts/live-smoke.mjs (the execution primitive — zero new
 * browser-driving logic here, just a manifest walker + result collector).
 *
 * Usage:
 *   node scripts/smoke-sweep.mjs [--category=A,B] [--env=prod,local] [--id=<id>]
 *
 * Exit code: 0 = every filtered entry ran and passed. 1 = at least one FAILED.
 * 2 = nothing failed but at least one entry could not be RUN (its dependency was
 * unavailable). Three states, because "it passed", "it broke" and "I could not
 * check" are three different facts and a sweep that reports the third as either of
 * the other two is worse than no sweep — see AGENTS.md rule 5.
 *
 * Output: one line per entry as it runs, then a pass/fail table, then writes
 * test-results/smoke-sweep/summary.json ({id, category, env, ok, args}[]).
 * Each entry's own live-smoke output (report.json/screenshot.png, for --path
 * entries only — --spec/--file entries have no per-entry report, only an
 * exit code) lands in test-results/smoke-sweep/<id>/ so nothing overwrites
 * a sibling entry's evidence.
 *
 * Exit code: 0 only if every FILTERED entry passed.
 */
import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST_PATH = join(APP_ROOT, 'scripts/smoke-sweep.manifest.json')
const SUMMARY_DIR = join(APP_ROOT, 'test-results/smoke-sweep')

/**
 * A manifest entry may declare `"requires": ["<name>"]`. Each name is probed ONCE
 * per run, before anything executes, and an entry whose requirement is unavailable
 * is reported as UNAVAILABLE rather than run and failed.
 *
 * This exists because of what the first real category-B run produced. Sixteen authed
 * entries ran against a local dev server; five of them "failed" with sixteen missing
 * selectors, and every one traced to the environment rather than the product: nothing
 * was listening on :9000, so `getMySeller()` fetch-failed across the whole seller
 * portal, and no dev Clerk fixture owns a row in `marketplace_shops` (verified: zero
 * rows for all three user ids). Read as a pass/fail table that is sixteen regressions.
 * It was zero.
 */
/**
 * Reads `.env.local` the way `live-smoke.mjs` does. Values are NEVER printed — only
 * the presence/absence of a key ever reaches the output.
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
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * Decides the seller-shop-fixture probe from an already-fetched result. Pure, so the
 * three states are testable without a network or a database.
 *
 * `reachable: false` must NOT report the fixture as missing — an unreachable Supabase
 * is an outage, and saying "the seller owns no shop" because we could not ask is the
 * confident falsehood this whole mechanism exists to prevent.
 */
export function decideSellerShopFixture({ reachable, rowCount, configured }) {
  if (!configured) return { ok: false, detail: 'MS_TEST_SELLER_EMAIL / Supabase credentials not resolvable — cannot check' }
  if (!reachable) return { ok: false, detail: 'Supabase unreachable — the fixture may or may not exist, this is not a verdict' }
  return { ok: rowCount > 0, detail: rowCount > 0 ? 'present' : 'the seller owns no marketplace_shops row' }
}

const PROBES = {
  /**
   * The seller must OWN A SHOP, and until 2026-08-20 nothing checked it.
   *
   * `playwright-seller@miyagisanchez.com` owned no `marketplace_shops` row, so every
   * `/shop/manage/*` spec 404'd before rendering and reported sixteen missing
   * selectors that read exactly like a broken seller portal. The fix was one row
   * (`qa-playwright-fixture`); this is what stops its absence being silent again —
   * a documented dependency nothing verifies is not a dependency, it is a comment.
   *
   * Queried by the fixture's own stable slug rather than by joining on the Clerk id,
   * because the id lives in a dev instance this script has no business resolving.
   */
  'seller-shop-fixture': {
    describe: 'the dev seller owns a marketplace_shops row (qa-playwright-fixture)',
    hint: "see e2e/README.md → 'The seller fixture owns a shop' for the INSERT",
    async check() {
      const env = { ...loadDotEnvLocal(), ...process.env }
      const url = env.SUPABASE_URL
      const key = env.SUPABASE_SERVICE_ROLE_KEY
      if (!url || !key) return decideSellerShopFixture({ configured: false })
      try {
        const res = await fetch(
          `${url}/rest/v1/marketplace_shops?slug=eq.qa-playwright-fixture&select=slug`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) },
        )
        if (!res.ok) return decideSellerShopFixture({ configured: true, reachable: false })
        const rows = await res.json()
        return decideSellerShopFixture({ configured: true, reachable: true, rowCount: Array.isArray(rows) ? rows.length : 0 })
      } catch {
        return decideSellerShopFixture({ configured: true, reachable: false })
      }
    },
  },

  'medusa-local': {
    describe: 'a local Medusa on :9000 (MEDUSA_STORE_URL for --env=local)',
    hint: 'cd apps/backend && npx medusa dev',
    async check() {
      try {
        await fetch('http://localhost:9000/health', { signal: AbortSignal.timeout(3000) })
        return { ok: true, detail: 'responding' }
      } catch {
        return { ok: false, detail: 'nothing listening on :9000' }
      }
    },
  },
}

/** Probes every requirement the filtered entries name. Unknown names are fatal. */
async function resolveRequirements(entries) {
  const names = [...new Set(entries.flatMap((e) => e.requires ?? []))]
  const availability = new Map()
  for (const name of names) {
    const probe = PROBES[name]
    // An unknown requirement is a typo in the manifest, and silently treating it as
    // satisfied would restore exactly the false confidence this whole mechanism exists
    // to remove.
    if (!probe) throw new Error(`smoke-sweep: manifest requires "${name}", which has no probe in PROBES`)
    // The DETAIL is printed, not just the verdict. A probe that says only
    // "UNAVAILABLE" cannot distinguish "the fixture is missing" from "I could not
    // reach the database to ask" — which is the same two-states-for-three-facts
    // collapse this whole mechanism exists to prevent, one level down. Caught by
    // mutating the probe and watching both mutations print an identical line.
    const result = await probe.check()
    const ok = result.ok
    console.log(
      `smoke-sweep: requirement "${name}" — ${ok ? 'available' : 'UNAVAILABLE'}: ${result.detail} (${probe.describe})`,
    )
    availability.set(name, ok)
  }
  return availability
}

/** Which of an entry's requirements are not satisfied. Pure. */
export function unmetRequirements(entry, availability) {
  return (entry.requires ?? []).filter((name) => availability.get(name) === false)
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      category: { type: 'string' },
      env: { type: 'string' },
      id: { type: 'string' },
    },
  })
  return {
    categories: values.category ? values.category.split(',') : null,
    envs: values.env ? values.env.split(',') : null,
    id: values.id ?? null,
  }
}

export function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

export function filterEntries(entries, filters) {
  return entries.filter((e) => {
    if (filters.id && e.id !== filters.id) return false
    if (filters.categories && !filters.categories.includes(e.category)) return false
    if (filters.envs && !filters.envs.includes(e.env)) return false
    return true
  })
}

export function buildArgs(entry) {
  const args = [`--env=${entry.env}`, `--flow=${entry.flow}`]
  if (entry.path) args.push(`--path=${entry.path}`)
  else if (entry.spec) args.push(`--spec=${entry.spec}`)
  else if (entry.file) args.push(`--file=${entry.file}`)
  return args
}

async function main() {
  const filters = parseCliArgs()
  const entries = filterEntries(loadManifest().entries, filters)
  if (entries.length === 0) {
    console.error('smoke-sweep: no manifest entries matched the given filters')
    process.exit(2)
  }

  const availability = await resolveRequirements(entries)
  const results = []

  for (const entry of entries) {
    const unmet = unmetRequirements(entry, availability)
    if (unmet.length > 0) {
      console.log(`\n=== ${entry.id} (${entry.category}) — UNAVAILABLE: needs ${unmet.join(', ')} ===`)
      results.push({ id: entry.id, category: entry.category, env: entry.env, flow: entry.flow, status: 'unavailable', unmet, args: buildArgs(entry), report: null })
      continue
    }
    const entryOutDir = `test-results/smoke-sweep/${entry.id}`
    mkdirSync(join(APP_ROOT, entryOutDir), { recursive: true })
    const args = buildArgs(entry)
    console.log(`\n=== ${entry.id} (${entry.category}) — live-smoke ${args.join(' ')} ===`)

    const result = spawnSync('node', ['scripts/live-smoke.mjs', ...args], {
      cwd: APP_ROOT,
      env: { ...process.env, LIVE_SMOKE_OUT: entryOutDir },
      stdio: 'inherit',
    })

    const reportPath = join(APP_ROOT, entryOutDir, 'report.json')
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null
    results.push({
      id: entry.id, category: entry.category, env: entry.env, flow: entry.flow,
      status: (result.status ?? 1) === 0 ? 'passed' : 'failed', unmet: [], args, report,
    })
  }

  // Recreated HERE, not once at the top. Playwright cleans its `test-results/`
  // output directory on every run, so a sweep whose LAST entry drives a spec file
  // deletes the directory the summary is about to be written into — an ENOENT that
  // threw away the evidence of a completed 16-entry run, after it had completed.
  mkdirSync(SUMMARY_DIR, { recursive: true })
  writeFileSync(join(SUMMARY_DIR, 'summary.json'), JSON.stringify(results, null, 2))

  const MARK = { passed: '✓', failed: '✗', unavailable: '·' }
  console.log('\n--- smoke-sweep summary ---')
  for (const r of results) {
    const why = r.status === 'unavailable' ? ` (needs ${r.unmet.join(', ')})` : ''
    console.log(`${MARK[r.status]} [${r.category}] ${r.id}${why}`)
  }

  const failed = results.filter((r) => r.status === 'failed')
  const unavailable = results.filter((r) => r.status === 'unavailable')
  const passed = results.filter((r) => r.status === 'passed')
  console.log(`\n${passed.length} passed, ${failed.length} failed, ${unavailable.length} unavailable, of ${results.length}.`)
  console.log(`Summary: ${join(SUMMARY_DIR, 'summary.json')}`)
  if (failed.length) console.log(`Failed: ${failed.map((r) => r.id).join(', ')}`)
  if (unavailable.length) {
    console.log(`\nNOT RUN — these are not passes:`)
    for (const name of [...new Set(unavailable.flatMap((r) => r.unmet))]) {
      console.log(`  ${name}: ${PROBES[name].describe}\n    -> ${PROBES[name].hint}`)
    }
  }

  process.exit(failed.length ? 1 : unavailable.length ? 2 : 0)
}

/**
 * Only run when this file IS the entry point. e2e/smoke-sweep-manifest.spec.ts
 * imports the pure half (loadManifest/filterEntries/buildArgs) to guard the
 * manifest; without this check that import would spawn the whole live sweep.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
