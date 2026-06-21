/**
 * cache-policy.ts — the single, documented home for how long storefront reads may be cached.
 *
 * Why this seam exists: the Neon-egress epic (Roadmap 09-platform-infra/neon-egress-and-db-isolation)
 * needs every storefront/Store-API read to be served from cache so it doesn't cascade FE → Cloud Run →
 * Neon and burn the org's 5 GB/mo public-transfer allowance. The revalidate windows used to live as
 * scattered magic numbers across `lib/listings.ts` and the public API routes; consolidating them here
 * gives one place to read the freshness rationale and one line to tune (and a spec can guard the
 * values from drifting).
 *
 * Dependency-free on purpose — it imports nothing from `next/*`, so the Playwright runner can unit-test
 * it directly (a helper that imports `next/cache` can't be loaded by the test runner — see
 * Roadmap/LEARNINGS.md → Tooling gotchas).
 *
 * Freshness contract (confirmed with Daniel, 2026-06-21): keep ~60s windows so a price/stock edit is
 * visible within roughly a minute. Money mutations (checkout, offers) are NEVER cached — these windows
 * apply only to read paths.
 */

/** Revalidate / s-maxage windows, in **seconds**, by read kind. */
export const CACHE = {
  /** Single listing / PDP read. Price + stock must feel current → ~1 min. */
  LISTING: 60,
  /** Shop identity (name, logo, theme). Changes rarely → 2 min. */
  SHOP: 120,
  /** Catalog / search / agent feed (UCP, embed catalog). Freshest discovery surface → 30 s. */
  CATALOG: 30,
  /** Live category counts. Coarse aggregate, tolerant of lag → 5 min. */
  CATEGORY: 300,
} as const

export type CacheKind = keyof typeof CACHE

/**
 * Build the CDN `Cache-Control` value for a public, edge-cacheable response.
 * `s-maxage` is the shared/CDN freshness window; `stale-while-revalidate` (2×) lets the edge serve a
 * slightly-stale copy while it refreshes in the background, so a cache miss never blocks a visitor.
 *
 * Use on anonymous, non-personalized read routes only (catalog/embed/text) — never on a response that
 * varies per user or carries a money mutation.
 */
export function storefrontCacheControl(maxAgeSeconds: number): string {
  return `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}`
}
