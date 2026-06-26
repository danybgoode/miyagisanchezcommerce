import type { Listing } from './types'
import { CATEGORIES } from './types'
import { CACHE } from './cache-policy'

/**
 * Homepage Polish — Dirección B · Sprint 2: the curation + category-count logic,
 * kept in a next-free seam so a pure-logic Playwright `api` spec
 * (`e2e/home-curation.spec.ts`) proves the rules without network/auth. The cached
 * Medusa wrappers in `lib/listings.ts` (`getCuratedListings`, `getFeaturedListing`,
 * `getCategoryCounts`) import these — this module never imports `next/*`.
 *
 * Sprint 3 (S3.1) adds a deterministic per-ISR-window shuffle of the UNPINNED grid
 * remainder (`windowSeed` + `seededShuffle`, threaded into `curateGrid`): the order
 * is stable within a revalidate window (so the static `/` HTML serves everyone with
 * no hydration mismatch) yet rotates across windows. Pinned/admin-ordered items and
 * the featured pick stay fixed.
 */

/** Curation window: an unpinned listing older than this is excluded (cold-start, not recency). */
export const MAX_AGE_DAYS = 14
/** A timestamp badge shows only when the listing is younger than this. */
export const RECENT_HOURS = 48
/** Default Selección grid size (the floor: a thin board still auto-fills to here). */
export const GRID_SIZE = 4
/** Hard cap on Selección grid cards (Destacado + grid ≤ 12) — a runaway guard. */
export const GRID_CAP = 11
/**
 * The ISR revalidate window in ms, mirrored from the cache-policy SSOT
 * (`CACHE.LISTING`, seconds). The homepage's own `export const revalidate` is a
 * static literal that tracks the *same* SSOT (Next requires `revalidate` to be
 * statically analyzable, so it can't import this) — so the shuffle cadence matches
 * the homepage's ISR cadence as long as both track `CACHE.LISTING`. The per-window
 * shuffle seed buckets time by this window.
 */
export const REVALIDATE_MS = CACHE.LISTING * 1000

/**
 * The current ISR time-bucket — `floor(now / REVALIDATE_MS)`. Stable within a
 * revalidate window (same value for every render of the same static HTML, so no
 * hydration mismatch) and increments at each window boundary (so the shuffle
 * rotates). This is the deterministic seed for `seededShuffle`.
 */
export function windowSeed(now: number): number {
  return Math.floor(now / REVALIDATE_MS)
}

/** Deterministic 32-bit PRNG (mulberry32). Same seed ⇒ same stream — no global state. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A non-mutating, seeded Fisher–Yates shuffle: returns a new array, leaves the input
 * untouched, and is fully determined by `seed` (same seed ⇒ identical permutation,
 * different seed ⇒ a different one). Used to rotate the unpinned grid remainder per
 * ISR window.
 */
export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** Pinned = the seller/admin set `metadata.featured = true` on the Medusa product. */
export function isPinned(l: Listing): boolean {
  return l.metadata?.featured === true
}

/**
 * The admin-chosen order for a pin (`metadata.featured_rank`, asc; 1 shows first).
 * Unranked pins sort last among pins → fall back to fresh order. Non-pins → Infinity.
 */
export function featuredRank(l: Listing): number {
  if (!isPinned(l)) return Infinity // a stale rank on an unpinned listing is not a pin order
  const r = l.metadata?.featured_rank
  return typeof r === 'number' && Number.isFinite(r) ? r : Infinity
}

/**
 * Merge listing lists into one, deduped by `id` (first occurrence wins),
 * non-mutating. The Selección pool (S2.2) unions the freshest-24 fetch with the
 * explicit `?featured=true` pin fetch so a pin renders no matter how old it is;
 * order is irrelevant here because `pickFeatured` / `curateGrid` re-sort.
 */
export function unionById(...lists: Listing[][]): Listing[] {
  const seen = new Set<string>()
  const out: Listing[] = []
  for (const list of lists) {
    for (const l of list) {
      if (!seen.has(l.id)) {
        seen.add(l.id)
        out.push(l)
      }
    }
  }
  return out
}

function ageMs(createdAt: string, now: number): number {
  return now - new Date(createdAt).getTime()
}

/**
 * Qualifies for the Selección. Every listing must be active/published with ≥1 image
 * (no broken Destacado). A **pin is authoritative** past there: it qualifies
 * regardless of price (the "Sin precio" events/agenda/art the admin curates) and
 * regardless of freshness — so the admin's hand-curation always renders. An UNPINNED
 * listing still needs a price AND must be fresh (within MAX_AGE_DAYS).
 */
export function isQualifying(l: Listing, now: number): boolean {
  const active = l.status === 'active' || l.status === 'published'
  const hasImage = (l.images?.length ?? 0) > 0
  if (!active || !hasImage) return false
  if (isPinned(l)) return true // a pin overrides BOTH the price and the freshness gates
  const hasPrice = l.price_cents != null
  if (!hasPrice) return false
  return ageMs(l.created_at, now) <= MAX_AGE_DAYS * DAY_MS
}

/**
 * Sort: pinned first, then (among pins) by the admin's `featured_rank` asc, then
 * freshest (created_at desc) as the tie-break / unranked fallback. Stable,
 * non-mutating. So the admin order on `/admin/seleccion` drives the Selección.
 */
function byPinnedThenFresh(a: Listing, b: Listing): number {
  const pa = isPinned(a) ? 1 : 0
  const pb = isPinned(b) ? 1 : 0
  if (pa !== pb) return pb - pa
  if (pa === 1 && pb === 1) {
    const ra = featuredRank(a)
    const rb = featuredRank(b)
    if (ra !== rb) return ra - rb
  }
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

/**
 * The featured pick: the freshest pinned qualifying listing if any, otherwise the
 * freshest qualifying listing. `null` when nothing qualifies.
 */
export function pickFeatured(listings: Listing[], now: number): Listing | null {
  const qualifying = listings.filter(l => isQualifying(l, now)).sort(byPinnedThenFresh)
  return qualifying[0] ?? null
}

/**
 * The grid card count: grows to fit **every** remaining qualifying pin (after the
 * excluded Destacado, so the admin's full curation always renders), floored at
 * GRID_SIZE so a thin board still auto-fills, and capped at GRID_CAP as a runaway
 * guard. Pass the result as `n` to `curateGrid` — pins sort first there, so
 * `n >= remainingPins` guarantees no pin is ever sliced off.
 */
export function curatedGridSize(listings: Listing[], now: number, excludeId?: string): number {
  const remainingPins = listings.filter(
    l => isQualifying(l, now) && l.id !== excludeId && isPinned(l),
  ).length
  return Math.min(GRID_CAP, Math.max(GRID_SIZE, remainingPins))
}

/**
 * The curated grid: qualifying listings, pinned-first then freshest, excluding the
 * featured card (`excludeId`) so it never appears twice, sliced to `n`.
 *
 * When `seed` is given (S3.1), the **pinned** items keep their admin order at the
 * front, but the **unpinned remainder is shuffled by `seed`** instead of sorted by
 * freshness — so the auto-filled slots rotate per ISR window (the page passes
 * `windowSeed(now)`) while pins stay fixed. Without a `seed`, the legacy
 * freshest-first order is preserved unchanged.
 */
export function curateGrid(
  listings: Listing[],
  now: number,
  n = GRID_SIZE,
  excludeId?: string,
  seed?: number,
): Listing[] {
  const qualifying = listings.filter(l => isQualifying(l, now) && l.id !== excludeId)
  if (seed === undefined) {
    return qualifying.sort(byPinnedThenFresh).slice(0, n)
  }
  const pinned = qualifying.filter(isPinned).sort(byPinnedThenFresh)
  const unpinned = seededShuffle(qualifying.filter(l => !isPinned(l)), seed)
  return [...pinned, ...unpinned].slice(0, n)
}

/** Whether a listing is young enough to show its timestamp badge (< RECENT_HOURS). */
export function isRecentForBadge(createdAt: string, now: number): boolean {
  return ageMs(createdAt, now) < RECENT_HOURS * HOUR_MS
}

export type CategoryCount = { key: string; label: string; icon: string; count: number }

/**
 * Projects a category→count map onto CATEGORIES, dropping every category with no
 * active listing and preserving CATEGORIES order. Drives the "Categorías con vida"
 * module — buyers never see an empty category.
 */
export function liveCategoryCounts(counts: Record<string, number>): CategoryCount[] {
  return CATEGORIES.flatMap(cat => {
    const count = counts[cat.key] ?? 0
    return count >= 1 ? [{ key: cat.key, label: cat.label, icon: cat.icon, count }] : []
  })
}
