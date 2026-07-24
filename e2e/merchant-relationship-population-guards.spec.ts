import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Founding merchant activation operations · Sprint 3 — "guard the
 * population, not the door you found" (Roadmap/LEARNINGS.md), applied
 * mechanically rather than asserted in a comment. Three population-wide
 * invariants the build contract names explicitly:
 *
 *   1. No call site outside the ONE seam passes a raw shop id (or anything
 *      else) straight into `emitMerchantLifecycle` — every caller that only
 *      has a shop id must go through `emitMerchantLifecycleForShop`
 *      (Story 3.2). Walked by SCANNING every `.ts`/`.tsx` file under `app/`
 *      and `lib/`, not by trusting the two call sites the build contract
 *      happened to name — a third one added later is caught the same way.
 *   2. `lib/merchant-commerce-facts.ts` (Story 3.1's adapter) exports no
 *      mutation at all — no Supabase write verb, no fetch of any kind (every
 *      Medusa read it needs is a re-exported GET from `lib/merchant-
 *      lifecycle-sweep.ts`).
 *   3. The reconciliation surface (Story 3.3) holds no Medusa WRITE client —
 *      no non-GET fetch, no admin-write import — in its own read module or
 *      either of its two routes. Supabase writes to
 *      `merchant_relationship_transitions` / `merchant_relationships.stage`
 *      ARE the intended repair mechanism and are NOT checked here; only
 *      Medusa (commerce) mutation is forbidden.
 *
 * Pure source-text scanning, no network, no DB — same technique
 * `e2e/_fixtures/merchant-lifecycle.ts` already uses (`readFileSync` against
 * `import.meta.url`-relative paths) because the package is `"type": "module"`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function listSourceFiles(startDir: string): string[] {
  const out: string[] = []
  const skip = new Set(['node_modules', '.next', '.worktrees', '.git'])
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (extname(entry) === '.ts' || extname(entry) === '.tsx') {
        out.push(full)
      }
    }
  }
  walk(startDir)
  return out
}

test.describe('population guard · emitMerchantLifecycle has exactly one legitimate direct caller', () => {
  // The ONLY two files allowed to call the bare `emitMerchantLifecycle(` —
  // its own definition/internal delegation, and the stage-transition seam
  // (which already holds the opaque relationship id, so it needs no
  // shop→relationship resolution hop). Every other file with a shop id in
  // hand must go through `emitMerchantLifecycleForShop`.
  const ALLOWED = new Set(['lib/merchant-lifecycle-server.ts', 'lib/merchant-relationship-lifecycle.ts'])

  test('no source file outside the seam calls the bare function', () => {
    const offenders: string[] = []
    for (const dir of [join(ROOT, 'app'), join(ROOT, 'lib')]) {
      for (const file of listSourceFiles(dir)) {
        const rel = relative(ROOT, file).replace(/\\/g, '/')
        if (ALLOWED.has(rel)) continue
        const text = readFileSync(file, 'utf8')
        // `emitMerchantLifecycle(` but NOT `emitMerchantLifecycleForShop(` — the
        // regex naturally distinguishes them: the character right after
        // `emitMerchantLifecycle` in the ForShop name is `F`, never `(`.
        if (/\bemitMerchantLifecycle\(/.test(text)) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  test('sanity — the allow-listed seam files DO still call it (the scan itself is not vacuous)', () => {
    for (const rel of ALLOWED) {
      const text = readFileSync(join(ROOT, rel), 'utf8')
      expect(/\bemitMerchantLifecycle\(/.test(text), rel).toBe(true)
    }
  })
})

const FORBIDDEN_WRITE_VERBS = [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/]

test.describe('population guard · Story 3.1 commerce-fact adapter exports no mutation', () => {
  const file = join(ROOT, 'lib', 'merchant-commerce-facts.ts')
  const text = readFileSync(file, 'utf8')

  test('no Supabase write verb', () => {
    for (const pattern of FORBIDDEN_WRITE_VERBS) expect(pattern.test(text), pattern.toString()).toBe(false)
  })

  test('no fetch of any kind — every Medusa read is a re-exported GET from the sweep', () => {
    expect(text.includes('fetch(')).toBe(false)
  })

  test('sanity — the module DOES read Supabase and Medusa (the scan is not vacuous)', () => {
    expect(text.includes(".from('marketplace_shops')")).toBe(true)
    expect(text.includes('countLiveProductsFromMedusa')).toBe(true)
  })
})

test.describe('population guard · Story 3.3 reconciliation holds no Medusa write client', () => {
  const files = [
    join(ROOT, 'lib', 'relationship-reconciliation.ts'),
    join(ROOT, 'app', 'api', 'admin', 'relationships', 'reconciliation', 'route.ts'),
    join(ROOT, 'app', 'api', 'admin', 'relationship', '[id]', 'replay', 'route.ts'),
  ]

  for (const file of files) {
    test(`no non-GET fetch in ${relative(ROOT, file)}`, () => {
      const text = readFileSync(file, 'utf8')
      expect(text.includes('fetch(')).toBe(false)
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(text.includes(`method: '${method}'`)).toBe(false)
      }
    })
  }
})
