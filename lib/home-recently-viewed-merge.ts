import type { RecentFavorite } from './home-favorites'
import { derivePriceDrop, type PriceDrop } from './home-personalization'

/**
 * The pure merge/label seam for the homepage rail's recently-viewed cards
 * (home-dynamic-rows-restore-and-polish S2.3). Kept free of `localStorage`/DOM so it's
 * directly unit-testable (`e2e/home-recently-viewed.spec.ts`) with no browser needed —
 * the localStorage read/fetch glue lives in `HomeRetomaOffers.tsx`, which calls this.
 */

/** Combined favorites + recently-viewed cap on the rail. */
export const RAIL_CAP = 6

export type RailCardSource = 'favorite' | 'viewed'

export interface RailCard {
  medusaId: string
  title: string
  priceCents: number | null
  currency: string
  condition: string | null
  location: string | null
  imageUrl: string | null
  source: RailCardSource
  /** 'Favorito' | 'Visto hoy' | 'Visto ayer' */
  label: string
  priceDrop: PriceDrop
}

/** Card display data for a viewed (non-favorited) listing, resolved via the batched read. */
export type ViewedCardData = Omit<RailCard, 'source' | 'label' | 'priceDrop'>

export interface ViewedWithCard {
  ts: number
  card: ViewedCardData
}

/**
 * "Visto hoy" (same calendar day as `now`), "Visto ayer" (exactly one calendar day
 * back), or `null` (older — dropped from the rail; the v1 scope is device-local
 * recency, not an unbounded history). Deliberately a CALENDAR-DAY diff, not a raw
 * 24h/48h window — an 11pm-yesterday view should read "ayer", not "hoy", and a view
 * 20h ago that hasn't crossed midnight should still read "hoy".
 */
export function viewedLabel(ts: number, now: number): 'Visto hoy' | 'Visto ayer' | null {
  const startOfDay = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const dayDiff = Math.round((startOfDay(now) - startOfDay(ts)) / (24 * 60 * 60 * 1000))
  if (dayDiff === 0) return 'Visto hoy'
  if (dayDiff === 1) return 'Visto ayer'
  return null
}

/**
 * Merge favorites + recently-viewed into the rail's card list. Favorites WIN on id
 * collision (a favorited-and-viewed item appears once, as a favorite — never
 * duplicated); a stale (2+ days old) viewed entry is dropped entirely, not just
 * unlabeled; favorites-first ordering (their own recency order preserved), then
 * viewed-only by most-recent `ts`; sliced to `RAIL_CAP`.
 */
export function mergeRailCards(
  favorites: RecentFavorite[],
  viewed: ViewedWithCard[],
  now: number,
): RailCard[] {
  const favoriteIds = new Set(favorites.map((f) => f.medusaId))

  const favoriteCards: RailCard[] = favorites.map((f) => ({
    medusaId: f.medusaId,
    title: f.title,
    priceCents: f.priceCents,
    currency: f.currency,
    condition: f.condition,
    location: f.location,
    imageUrl: f.imageUrl,
    source: 'favorite',
    label: 'Favorito',
    priceDrop: derivePriceDrop(f.priceCentsAtSave, f.priceCents),
  }))

  const viewedCards: RailCard[] = viewed
    .filter((v) => !favoriteIds.has(v.card.medusaId))
    .sort((a, b) => b.ts - a.ts)
    .map((v) => ({ ...v.card, ts: v.ts, label: viewedLabel(v.ts, now) }))
    .filter((v): v is ViewedCardData & { ts: number; label: 'Visto hoy' | 'Visto ayer' } => v.label !== null)
    .map(({ ts: _ts, ...card }) => ({
      ...card,
      source: 'viewed',
      priceDrop: { dropped: false, dropAmountCents: 0 },
    }))

  return [...favoriteCards, ...viewedCards].slice(0, RAIL_CAP)
}
