#!/usr/bin/env node
/**
 * Every column this codebase asks Supabase for, checked against the columns Supabase
 * actually has.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * `app/(shell)/messages/*` selected `marketplace_shops.market_code`, a column that
 * has never existed. PostgREST answers 400 for the WHOLE query, and both call sites
 * discarded the `error` — so for four days `/messages` rendered an empty inbox and
 * `/messages/[id]` rendered a 404, for every user, with no alert and a 200 status.
 *
 * Grepping for that one column would have fixed that one door. Running this scan
 * found two more of the same defect on the first pass (`marketplace_orders.
 * payment_method`, `marketplace_return_requests.buyer_name`). Guard the population,
 * not the door you found.
 *
 * ── WHY IT IS A SCRIPT AND NOT A SPEC ────────────────────────────────────────
 * It needs the live schema. The Playwright `api` project is the deterministic gate
 * and must not depend on database credentials, so this runs on demand — before a
 * release, and any time a migration lands. It FAILS LOUDLY without credentials
 * rather than exiting 0 having checked nothing: a green run that verified nothing is
 * worse than no check at all.
 *
 *   node --env-file=.env.local scripts/audit-select-columns.mjs
 *
 * Exit 0 = every referenced column exists. Exit 1 = at least one does not, or the
 * schema could not be read.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SKIP = new Set(['node_modules', '.next', '.git', 'test-results', '.worktrees', 'playwright-report'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Pull `(table, column)` pairs out of `.from('t').select('a, b, rel(c, d)')`.
 *
 * Embedded relations are followed as their own table, because that is how PostgREST
 * resolves them and it is where the original bug lived. `*` and aliases are ignored;
 * an alias (`shop:marketplace_shops(...)`) is resolved to the real table name.
 */
function referencedPairs(files) {
  const fromRe = /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g
  const selectRe = /\.select\(\s*([`'"])([\s\S]*?)\1/
  const pairs = new Map() // "table.column" -> Set of "file:line"

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(fromRe)) {
      const table = m[1]
      const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 400)
      const sm = selectRe.exec(tail)
      // Another `.from(` before the `.select(` means these two are not a pair.
      if (!sm || tail.slice(0, sm.index).includes('.from(')) continue
      const line = src.slice(0, m.index).split('\n').length
      const where = `${relative(ROOT, file)}:${line}`

      const cols = sm[2]
      const add = (t, c) => {
        const name = c.trim().split(':').pop().replace(/!inner|!left/g, '').trim()
        if (!/^[a-z0-9_]+$/.test(name) || name === '*') return
        const key = `${t}.${name}`
        if (!pairs.has(key)) pairs.set(key, new Set())
        pairs.get(key).add(where)
      }

      // Top-level columns: everything outside parentheses.
      //
      // A name immediately followed by `(` is an EMBEDDED RELATION, not a column of
      // this table — `marketplace_shops ( name, slug )` is a join, and reporting it
      // as a missing column of `marketplace_conversations` is a false positive. The
      // first version of this script did exactly that and flagged 16 correct call
      // sites; a guard that cries wolf gets deleted, so the buffer is DROPPED when a
      // `(` opens at depth 0.
      let depth = 0, buf = ''
      for (const ch of cols) {
        if (ch === '(') { if (depth === 0) buf = ''; depth++; continue }
        if (ch === ')') { depth--; continue }
        if (ch === ',' && depth === 0) { add(table, buf); buf = ''; continue }
        if (depth === 0) buf += ch
      }
      add(table, buf)

      // Embedded relations: `name ( a, b )` / `alias:name!inner ( a, b )`.
      for (const em of cols.matchAll(/([a-z0-9_]+)\s*(?:!inner|!left)?\s*\(([^()]*)\)/g)) {
        for (const c of em[2].split(',')) add(em[1], c)
      }
    }
  }
  return pairs
}

async function liveColumns() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required. Run with '
      + '`node --env-file=.env.local scripts/audit-select-columns.mjs`. '
      + 'Refusing to report a green result without checking anything.',
    )
  }
  // PostgREST cannot read information_schema, but it publishes an OpenAPI document
  // describing every table and column it exposes — which is exactly the surface a
  // `.select()` hits, so it is the right authority here.
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  })
  if (!res.ok) throw new Error(`schema read failed: HTTP ${res.status}`)
  const spec = await res.json()
  const cols = new Set()
  const tables = new Set()
  for (const [table, def] of Object.entries(spec.definitions ?? {})) {
    tables.add(table)
    for (const col of Object.keys(def.properties ?? {})) cols.add(`${table}.${col}`)
  }
  if (!cols.size) throw new Error('schema read returned no columns — refusing to pass')
  return { cols, tables }
}

const pairs = referencedPairs(walk(ROOT))
const { cols, tables } = await liveColumns()

// A table this scan does not recognise is NOT a failure — it may be a Medusa table,
// an RPC, or a name built at runtime. Unknown and absent are different facts, so
// unknown tables are reported separately rather than counted as misses.
const missing = []
const unknownTables = new Set()
for (const [key, sites] of pairs) {
  const table = key.split('.')[0]
  if (!tables.has(table)) { unknownTables.add(table); continue }
  if (!cols.has(key)) missing.push([key, [...sites]])
}

console.log(`checked ${pairs.size} table/column references across ${tables.size} tables`)
if (unknownTables.size) {
  console.log(`(${unknownTables.size} referenced names are not PostgREST tables — skipped: ${[...unknownTables].sort().join(', ')})`)
}

if (!missing.length) {
  console.log('✅ every referenced column exists')
  process.exit(0)
}

console.error(`\n❌ ${missing.length} reference(s) to a column that does not exist:`)
for (const [key, sites] of missing.sort()) {
  console.error(`   ${key}`)
  for (const site of sites) console.error(`      ${site}`)
}
console.error('\nPostgREST rejects the ENTIRE query with 400 for any one of these.')
process.exit(1)
