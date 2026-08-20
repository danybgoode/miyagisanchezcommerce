#!/usr/bin/env node
/**
 * smoke-sweep — walks scripts/smoke-sweep.manifest.json, running each entry
 * through scripts/live-smoke.mjs (the execution primitive — zero new
 * browser-driving logic here, just a manifest walker + result collector).
 *
 * Usage:
 *   node scripts/smoke-sweep.mjs [--category=A,B] [--env=prod,local] [--id=<id>]
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

function main() {
  const filters = parseCliArgs()
  const entries = filterEntries(loadManifest().entries, filters)
  if (entries.length === 0) {
    console.error('smoke-sweep: no manifest entries matched the given filters')
    process.exit(2)
  }

  mkdirSync(SUMMARY_DIR, { recursive: true })
  const results = []

  for (const entry of entries) {
    const entryOutDir = `test-results/smoke-sweep/${entry.id}`
    mkdirSync(join(APP_ROOT, entryOutDir), { recursive: true })
    const args = buildArgs(entry)
    console.log(`\n=== ${entry.id} (${entry.category}) — live-smoke ${args.join(' ')} ===`)

    const result = spawnSync('node', ['scripts/live-smoke.mjs', ...args], {
      cwd: APP_ROOT,
      env: { ...process.env, LIVE_SMOKE_OUT: entryOutDir },
      stdio: 'inherit',
    })

    const ok = (result.status ?? 1) === 0
    const reportPath = join(APP_ROOT, entryOutDir, 'report.json')
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null
    results.push({ id: entry.id, category: entry.category, env: entry.env, flow: entry.flow, ok, args, report })
  }

  writeFileSync(join(SUMMARY_DIR, 'summary.json'), JSON.stringify(results, null, 2))

  console.log('\n--- smoke-sweep summary ---')
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} [${r.category}] ${r.id}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed. Summary: ${join(SUMMARY_DIR, 'summary.json')}`)
  if (failed.length) {
    console.log(`Failed: ${failed.map((r) => r.id).join(', ')}`)
  }

  process.exit(failed.length ? 1 : 0)
}

/**
 * Only run when this file IS the entry point. e2e/smoke-sweep-manifest.spec.ts
 * imports the pure half (loadManifest/filterEntries/buildArgs) to guard the
 * manifest; without this check that import would spawn the whole live sweep.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
