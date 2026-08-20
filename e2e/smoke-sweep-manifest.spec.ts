import { test, expect } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { loadManifest, filterEntries, buildArgs, unmetRequirements, decideSellerShopFixture, normalizeProbeResult } from '../scripts/smoke-sweep.mjs'

/**
 * smoke-sweep manifest guard — keeps `scripts/smoke-sweep.manifest.json` honest.
 *
 * The manifest is a HAND-PICKED list of what the owed-smoke sweep runs, and a
 * hand-picked population decays while still passing. It was written 2026-07-12
 * with 41 entries; by 2026-08-19 four browser specs had shipped that it had never
 * heard of (home-hero-auth, interaction-feedback, market-selector,
 * orders-bulk-preview) and nothing anywhere said so — the sweep would have run
 * green having swept 36 of 40 files. Guard the population, not the door you found.
 *
 * The second rot is subtler. Two entries pointed at `/vende/migracion` and
 * `/vende/promotor/migracion`, which `one-landing-per-market` (#399) moved to
 * `/mx/vende/…` behind a 308. Both entries kept PASSING — the redirect resolved,
 * the page rendered, the smoke went green against a URL that no longer exists as a
 * route. A redirect is invisible to a passing spec, so the freshness check below
 * asserts on the FIRST response, not the final one.
 *
 * Three things are checked, and each is the negation-friendly form:
 *   1. coverage   — every e2e/*.browser.spec.ts is swept, OR listed in `excluded`
 *                   with a reason. Writing a reason is always available, so the
 *                   guard never has to be bypassed.
 *   2. liveness   — every `file` entry names a file that exists (catches the other
 *                   direction: a renamed spec leaving a dead manifest entry).
 *   3. freshness  — every `path` entry resolves with no redirect against baseURL.
 */

const ROOT = path.resolve(import.meta.dirname, '..')

test.describe('smoke-sweep manifest', () => {
  test('every browser spec is swept, or excluded with a reason', () => {
    const manifest = loadManifest()
    const swept = new Set(manifest.entries.filter((e) => e.file).map((e) => e.file))
    const excluded = new Set(Object.keys(manifest.excluded ?? {}).filter((k) => k !== '_'))

    const onDisk = readdirSync(path.join(ROOT, 'e2e'))
      .filter((f) => f.endsWith('.browser.spec.ts'))
      .map((f) => `e2e/${f}`)

    const unaccounted = onDisk.filter((f) => !swept.has(f) && !excluded.has(f))
    expect(
      unaccounted,
      'Add each to scripts/smoke-sweep.manifest.json "entries", or to "excluded" with the reason it is not swept.',
    ).toEqual([])
  })

  test('every excluded spec carries a real reason and still exists', () => {
    const manifest = loadManifest()
    for (const [file, reason] of Object.entries(manifest.excluded ?? {})) {
      if (file === '_') continue
      expect(existsSync(path.join(ROOT, file)), `excluded spec ${file} no longer exists`).toBe(true)
      expect(String(reason).trim().length, `excluded spec ${file} needs a reason`).toBeGreaterThan(20)
    }
  })

  test('every file entry names a spec that exists', () => {
    const missing = loadManifest()
      .entries.filter((e) => e.file && !existsSync(path.join(ROOT, e.file)))
      .map((e) => `${e.id} -> ${e.file}`)
    expect(missing, 'A renamed or deleted spec left a dead manifest entry.').toEqual([])
  })

  test('every entry has an id, a category, and exactly one target', () => {
    const seen = new Set<string>()
    for (const entry of loadManifest().entries) {
      expect(entry.id, 'every entry needs an id').toBeTruthy()
      expect(seen.has(entry.id), `duplicate manifest id "${entry.id}"`).toBe(false)
      seen.add(entry.id)
      expect(['A', 'B', 'C', 'D', 'E', 'F']).toContain(entry.category)
      const targets = [entry.path, entry.spec, entry.file].filter(Boolean)
      expect(targets.length, `${entry.id} must name exactly one of path/spec/file`).toBe(1)
      // buildArgs is what actually reaches live-smoke — assert the real call shape,
      // not a restatement of it.
      expect(buildArgs(entry)).toEqual([`--env=${entry.env}`, `--flow=${entry.flow}`, expect.stringMatching(/^--(path|spec|file)=/)])
    }
  })

  test('every declared requirement is documented and probeable', () => {
    const manifest = loadManifest()
    const documented = new Set(Object.keys(manifest.requirements ?? {}).filter((k) => k !== '_'))
    const used = new Set(manifest.entries.flatMap((e) => e.requires ?? []))
    // The runner treats an unknown requirement as fatal rather than satisfied; this
    // catches the typo at gate time instead of mid-sweep.
    expect([...used].filter((name) => !documented.has(name)), 'undocumented requirement').toEqual([])
  })

  test('an unmet requirement is reported, and a met one is not', () => {
    const entry = { id: 'x', requires: ['medusa-local'] }
    expect(unmetRequirements(entry, new Map([['medusa-local', false]]))).toEqual(['medusa-local'])
    expect(unmetRequirements(entry, new Map([['medusa-local', true]]))).toEqual([])
    // The negation has to stay available: an entry declaring nothing is never blocked.
    expect(unmetRequirements({ id: 'y' }, new Map([['medusa-local', false]]))).toEqual([])
  })

  test('every seller-flow entry declares the shop fixture it needs', () => {
    // The dependency that was documented-but-unchecked: a seller with no
    // marketplace_shops row makes every /shop/manage/* page 404 before rendering, and
    // the specs report missing selectors that read as a broken portal. Declaring it is
    // what turns that into an UNAVAILABLE with a reason.
    const missing = loadManifest()
      .entries.filter((e) => e.flow === 'seller' && !(e.requires ?? []).includes('seller-shop-fixture'))
      .map((e) => e.id)
    expect(missing, 'a seller-flow entry that does not declare seller-shop-fixture').toEqual([])
  })

  test('an unreachable Supabase is UNAVAILABLE, never "the fixture is missing"', () => {
    // The distinction the whole probe exists for. Reporting "the seller owns no shop"
    // because we could not ask is a confident falsehood.
    expect(decideSellerShopFixture({ configured: true, reachable: false }).ok).toBe(false)
    expect(decideSellerShopFixture({ configured: true, reachable: false }).detail).toMatch(/not a verdict/)
    expect(decideSellerShopFixture({ configured: false }).detail).toMatch(/cannot check/)
    // And a real answer in both directions.
    expect(decideSellerShopFixture({ configured: true, reachable: true, rowCount: 1 }).ok).toBe(true)
    expect(decideSellerShopFixture({ configured: true, reachable: true, rowCount: 0 }).ok).toBe(false)
    expect(decideSellerShopFixture({ configured: true, reachable: true, rowCount: 0 }).detail).toMatch(/owns no/)
  })

  test('a probe returning a bare boolean still reports a real reason', () => {
    // A probe written the old way yields `result.ok === undefined` — falsy, so the
    // requirement reports UNAVAILABLE with the reason printed as literally "undefined".
    expect(normalizeProbeResult(true)).toEqual({ ok: true, detail: 'available' })
    expect(normalizeProbeResult(false)).toEqual({ ok: false, detail: 'unavailable' })
    expect(normalizeProbeResult({ ok: true, detail: 'present' })).toEqual({ ok: true, detail: 'present' })
  })

  test('a probe returning garbage is unavailable, never a pass', () => {
    // The direction that matters: an unreadable probe result must never resolve to ok.
    for (const bad of [undefined, null, {}, 'yes', { ok: 'true' }]) {
      const out = normalizeProbeResult(bad)
      expect(out.ok, `probe returned ${JSON.stringify(bad)}`).toBe(false)
      expect(out.detail).toBeTruthy()
    }
  })

  test('filters select a subset, never silently nothing', () => {
    const entries = loadManifest().entries
    expect(filterEntries(entries, { categories: ['A'], envs: null, id: null }).length).toBeGreaterThan(0)
    expect(filterEntries(entries, { categories: ['B'], envs: null, id: null }).length).toBeGreaterThan(0)
    expect(
      filterEntries(entries, { categories: ['A'], envs: null, id: null }).length +
        filterEntries(entries, { categories: ['B'], envs: null, id: null }).length,
    ).toBe(entries.length)
    expect(filterEntries(entries, { categories: null, envs: null, id: 'nope' })).toEqual([])
  })

  /**
   * Scoped to category A / unauthed on purpose. The category-B admin paths
   * (/admin/audit, /admin/flags, /admin/promoter) 307 to `/` for an anonymous
   * caller — that is `requireAdmin` WORKING, and failing them here would be a
   * guard rejecting correct output, which is how guards get bypassed. Their
   * redirect is only meaningful under the admin session the sweep gives them.
   */
  test('no unauthed path entry has gone stale behind a redirect', async ({ request }) => {
    const stale: string[] = []
    for (const entry of loadManifest().entries) {
      if (!entry.path) continue
      if (entry.category !== 'A' || entry.flow !== 'unauthed') continue
      // maxRedirects:0 is the whole point — following the 308 is what hid the
      // /vende → /mx/vende move from every spec that "passed".
      const response = await request.get(entry.path, { maxRedirects: 0, failOnStatusCode: false })
      const status = response.status()
      if (status >= 300 && status < 400) {
        stale.push(`${entry.id}: ${entry.path} -> ${status} ${response.headers()['location'] ?? ''}`)
      }
    }
    expect(stale, 'Point the entry at the final URL; a redirect is invisible to a passing spec.').toEqual([])
  })
})
