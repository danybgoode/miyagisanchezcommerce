import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * POPULATION GUARD for the market catalog boundary — "guard the population, not the
 * door you found" (`Roadmap/LEARNINGS.md`), applied mechanically.
 *
 * The failure this prevents is not "one route forgot the filter". It is the shape
 * of the mistake: a previous epic guarded ONE write tool while seven siblings
 * stayed open, because the list of doors was hand-written. So nothing here is
 * hand-listed as a *discovery*. The scan walks `app/` and `lib/`, finds every file
 * that performs a marketplace catalog read against the Medusa store routes, and
 * requires each one to be CLASSIFIED. A new door added later is not "missed" — it
 * lands in no bucket and this spec goes red until somebody decides what it is.
 *
 * Three buckets, and the difference between them is the epic's whole thesis:
 *
 *   MARKET_SCOPED     — public marketplace browse. Must read through the market
 *                       seam (`lib/market-catalog.ts` → `marketCatalogFetch`).
 *   OWNERSHIP_SCOPED  — a by-id lookup on behalf of an owner, a buyer's own order,
 *                       or a payment webhook. Must NOT gain the market filter
 *                       (epic decision D4): adding it there is exactly the failure
 *                       this epic exists to prevent — an owned shop must keep
 *                       working with no marketplace membership at all.
 *   DEFERRED_D10      — the UCP/MCP agent surfaces. Decision D10 assigns their
 *                       `market` parameter to Sprint 2. They are safe to defer for
 *                       one specific, CHECKED reason: they accept no market input
 *                       today, so there is no door into another market through
 *                       them. The last test in this file asserts that, which makes
 *                       the deferral self-expiring — the moment Sprint 2 introduces
 *                       a `market` token in those files, this guard goes red and
 *                       forces them through the seam.
 *
 * Source-text scanning only: no network, no DB. Comments are stripped before every
 * scan, because a negative-containment guard that fires on a doc comment explaining
 * what the module deliberately avoids punishes the documentation
 * (`LEARNINGS.md`, five separate cases in one epic).
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
      if (stat.isDirectory()) walk(full)
      else if (extname(entry) === '.ts' || extname(entry) === '.tsx') out.push(full)
    }
  }
  walk(startDir)
  return out
}

/** `[^:]` keeps `https://` intact — see LEARNINGS on source-text guards. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CATALOG_PATH = '/store/listings'

/**
 * `/store/listings/:id/price-grid` and `/store/listings/:id/view` are SUB-RESOURCES
 * of an already-resolved listing (a price ladder, a view counter), not catalog
 * browse — scoping them by market would filter nothing and break an owned-shop PDP.
 */
function isSubResourceTail(tail: string): boolean {
  return /^(?:\/\$\{[^}]*\}|\/[\w.-]+)?\/(?:price-grid|view)\b/.test(tail)
}

/** Does this (comment-stripped) source perform a marketplace catalog read? */
function hasCatalogRead(stripped: string): boolean {
  let index = stripped.indexOf(CATALOG_PATH)
  while (index !== -1) {
    if (!isSubResourceTail(stripped.slice(index + CATALOG_PATH.length, index + CATALOG_PATH.length + 60))) {
      return true
    }
    index = stripped.indexOf(CATALOG_PATH, index + 1)
  }
  return false
}

function rel(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

// ── The classification. Discovery is mechanical; only the VERDICT is written down ──

const MARKET_SCOPED = new Set([
  'lib/listings.ts',
])

const OWNERSHIP_SCOPED = new Set([
  // A seller publishing: is this listing actually checkout-viable for its OWNER?
  'lib/listing-status.ts',
  // The seller's own edit form, loading their own product.
  'app/(shell)/sell/edit/[id]/page.tsx',
  // Post-purchase summary: the shop name for an order the buyer just paid for.
  'app/(shell)/payment/success/page.tsx',
  // Order enrichment and manual shipping, both keyed by an order the caller owns.
  'app/api/orders/[id]/route.ts',
  'app/api/orders/[id]/ship-manual/route.ts',
  // Payment webhooks enriching a paid order. No buyer, no browse, no market.
  'app/api/webhooks/stripe/route.ts',
  'app/api/webhooks/mercadopago/route.ts',
  // Admin supply import resolving a seller slug from a product id.
  'app/api/supply/listing-images/route.ts',
])

const DEFERRED_D10 = new Set([
  'app/api/ucp/catalog/route.ts',
  'app/api/ucp/catalog/[id]/route.ts',
  'app/api/ucp/mcp/route.ts',
])

const CLASSIFIED = new Set([...MARKET_SCOPED, ...OWNERSHIP_SCOPED, ...DEFERRED_D10])

const CATALOG_READERS = [join(ROOT, 'app'), join(ROOT, 'lib')]
  .flatMap(listSourceFiles)
  .filter((file) => hasCatalogRead(stripComments(readFileSync(file, 'utf8'))))
  .map(rel)
  .sort()

test.describe('population guard · every marketplace catalog reader is classified', () => {
  test('the scan itself found something (it is not vacuous)', () => {
    expect(CATALOG_READERS.length).toBeGreaterThan(5)
    expect(CATALOG_READERS).toContain('lib/listings.ts')
  })

  test('no UNCLASSIFIED file reads the marketplace catalog', () => {
    const unclassified = CATALOG_READERS.filter((file) => !CLASSIFIED.has(file))
    // If this fails, do not add the file to a set to make it green. Decide what it
    // is first: public browse (market-scoped) or an owner/transaction lookup (D4).
    expect(unclassified).toEqual([])
  })

  test('every classified entry still exists and still reads the catalog', () => {
    // The inverse direction: a stale allow-list entry is a guard that has quietly
    // stopped guarding anything.
    const stale = [...CLASSIFIED].filter((file) => !CATALOG_READERS.includes(file)).sort()
    expect(stale).toEqual([])
  })

  test('the three buckets are disjoint', () => {
    const all = [...MARKET_SCOPED, ...OWNERSHIP_SCOPED, ...DEFERRED_D10]
    expect(all.length).toBe(new Set(all).size)
  })
})

test.describe('population guard · the market-scoped seam has no bare catalog fetch', () => {
  // Every catalog read in `lib/listings.ts` must name its intent through a helper:
  // `marketCatalogFetch` (market-scoped) or `ownershipScopedFetch` (D4-exempt, and
  // documented as such at its definition). A plain `medusaFetch` on a catalog path
  // is the regression this test exists to catch — it is how the filter would get
  // quietly dropped by a later refactor.
  const ALLOWED_CALLEES = new Set(['marketCatalogFetch', 'ownershipScopedFetch', 'fetchListings'])
  const CALL_SITE = /(\w+)\(\s*(?:[^()`'"]*,\s*)?[`'"](\/store\/listings[^`'"]*)[`'"]/g

  for (const file of MARKET_SCOPED) {
    test(`${file} — every catalog read goes through a named helper`, () => {
      const stripped = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      const offenders: string[] = []
      let found = 0
      for (const match of stripped.matchAll(CALL_SITE)) {
        const [, callee, path] = match
        if (isSubResourceTail(path.slice(CATALOG_PATH.length))) continue
        found += 1
        if (!ALLOWED_CALLEES.has(callee)) offenders.push(`${callee}("${path}")`)
      }
      // Non-vacuity: a regex that matched nothing would pass silently.
      expect(found).toBeGreaterThan(5)
      expect(offenders).toEqual([])
    })
  }

  test('lib/listings.ts imports the fail-closed seam rather than re-deriving it', () => {
    const stripped = stripComments(readFileSync(join(ROOT, 'lib', 'listings.ts'), 'utf8'))
    expect(stripped).toContain("from './market-catalog'")
    expect(stripped).toContain('planMarketCatalogRead')
    expect(stripped).toContain('verifyMarketFilter')
  })

  test('owned-shop reads are NOT market-scoped (D4)', () => {
    // `/store/sellers/...` is the owned-shop seam. If a market parameter ever
    // appears on it, an owned shop starts depending on marketplace membership —
    // the precise failure this epic exists to prevent.
    const stripped = stripComments(readFileSync(join(ROOT, 'lib', 'listings.ts'), 'utf8'))
    for (const match of stripped.matchAll(/[`'"](\/store\/sellers[^`'"]*)[`'"]/g)) {
      expect(match[1], match[1]).not.toContain('market')
    }
    expect(stripped).toContain('/store/sellers/')
  })
})

test.describe('population guard · NEXT_PUBLIC inlining cannot be defeated by the resolver seam', () => {
  // Next inlines `NEXT_PUBLIC_*` only where it sees the literal text
  // `process.env.NEXT_PUBLIC_FOO`. Handing the whole `process.env` object to a
  // function bakes in `undefined` in the client bundle — that exact mistake caused
  // a live checkout outage (nextpublic-docker-buildargs-hardening).
  const BARE_PROCESS_ENV = /resolve(?:RegionIdForMarket|MarketplaceChannelId)\([^)]*\bprocess\.env\s*[,)]/

  test('no caller passes bare process.env into the resolvers', () => {
    const offenders = [join(ROOT, 'app'), join(ROOT, 'lib'), join(ROOT, 'components')]
      .flatMap(listSourceFiles)
      .filter((file) => BARE_PROCESS_ENV.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  test('the snapshot reads each variable by literal member access', () => {
    const stripped = stripComments(readFileSync(join(ROOT, 'lib', 'market-medusa.ts'), 'utf8'))
    expect(stripped).toContain('process.env.NEXT_PUBLIC_MEDUSA_MXN_REGION_ID')
    expect(stripped).toContain('process.env.MEDUSA_MXN_REGION_ID')
    expect(stripped).toContain('process.env.MEDUSA_SALES_CHANNEL_ID')
  })

  test('no single-market region/channel constant survives outside the resolver', () => {
    // `MXN_REGION_ID` as a module constant IS the single-market assumption (D5).
    const offenders = [join(ROOT, 'app'), join(ROOT, 'lib'), join(ROOT, 'components')]
      .flatMap(listSourceFiles)
      .filter((file) => /\b(?:const|let|var)\s+(?:MXN_REGION_ID|DEFAULT_SALES_CHANNEL_ID)\b/
        .test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  test('cart creation resolves its region from a market, not from a constant', () => {
    const stripped = stripComments(readFileSync(join(ROOT, 'lib', 'cart.ts'), 'utf8'))
    expect(stripped).toContain('resolveRegionIdForMarket')
    expect(stripped).toContain('DEFAULT_MARKET')
    expect(stripped).toContain('region_id: regionId')
  })
})

test.describe('population guard · the D10 deferral is self-expiring', () => {
  for (const file of DEFERRED_D10) {
    test(`${file} accepts no market input yet — deferring it is still safe`, () => {
      // This is the ENTIRE justification for deferring these three files to Sprint 2:
      // with no market input there is no door into another market through them, so
      // they cannot serve MX rows under a US request. The day that stops being true,
      // this test fails and the deferral ends.
      const stripped = stripComments(readFileSync(join(ROOT, file), 'utf8'))
      expect(/\bmarket(?:_code|s)?\b/.test(stripped), `${file} now mentions a market — route it through lib/market-catalog.ts`).toBe(false)
    })
  }
})
