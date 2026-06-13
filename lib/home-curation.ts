import type { Listing } from './types'
import { CATEGORIES } from './types'

/**
 * Homepage Polish — Dirección B · Sprint 2: the curation + category-count logic,
 * kept in a next-free seam so a pure-logic Playwright `api` spec
 * (`e2e/home-curation.spec.ts`) proves the rules without network/auth. The cached
 * Medusa wrappers in `lib/listings.ts` (`getCuratedListings`, `getFeaturedListing`,
 * `getCategoryCounts`) import these — this module never imports `next/*`.
 */

/** Curation window: an unpinned listing older than this is excluded (cold-start, not recency). */
export const MAX_AGE_DAYS = 14
/** A timestamp badge shows only when the listing is younger than this. */
export const RECENT_HOURS = 48
/** Default Selección grid size. */
export const GRID_SIZE = 4

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** Pinned = the seller/admin set `metadata.featured = true` on the Medusa product. */
export function isPinned(l: Listing): boolean {
  return l.metadata?.featured === true
}

function ageMs(createdAt: string, now: number): number {
  return now - new Date(createdAt).getTime()
}

/**
 * Qualifies for the Selección: active, has ≥1 image AND a price, and is either
 * pinned or fresh (within MAX_AGE_DAYS). Pin overrides the freshness cutoff.
 */
export function isQualifying(l: Listing, now: number): boolean {
  const active = l.status === 'active' || l.status === 'published'
  const hasImage = (l.images?.length ?? 0) > 0
  const hasPrice = l.price_cents != null
  if (!active || !hasImage || !hasPrice) return false
  return isPinned(l) || ageMs(l.created_at, now) <= MAX_AGE_DAYS * DAY_MS
}

/** Sort: pinned first, then freshest (created_at desc). Stable, non-mutating. */
function byPinnedThenFresh(a: Listing, b: Listing): number {
  const pa = isPinned(a) ? 1 : 0
  const pb = isPinned(b) ? 1 : 0
  if (pa !== pb) return pb - pa
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
 * The curated grid: qualifying listings, pinned-first then freshest, excluding the
 * featured card (`excludeId`) so it never appears twice, sliced to `n`.
 */
export function curateGrid(
  listings: Listing[],
  now: number,
  n = GRID_SIZE,
  excludeId?: string,
): Listing[] {
  return listings
    .filter(l => isQualifying(l, now) && l.id !== excludeId)
    .sort(byPinnedThenFresh)
    .slice(0, n)
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
