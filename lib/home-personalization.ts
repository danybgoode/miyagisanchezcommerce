import type { RecentFavorite } from './home-favorites'
import type { OfferAlertInput } from './home-offer-alert'

/**
 * Marketplace static-shell — Sprint 4 (Phase 2): the next-free seam for the homepage
 * personalization client islands. The static homepage (`app/(site)/page.tsx`) can no
 * longer read `currentUser()` — so the signed-in modules return as client islands that
 * fetch the S3 Cloud Run endpoint (`GET /store/home/personalization`) after hydration.
 * This module holds the wire-contract type + the pure render helpers the islands need,
 * kept free of `next/*` and the db/SDK clients so a pure-logic `api` spec
 * (`e2e/home-personalization.spec.ts`) covers them without auth/network.
 *
 * (`lib/listings.ts conditionLabel` can't be reused here — that module imports
 * `next/cache`, which the islands + the Playwright runner can't load — so the condition
 * label is re-derived below as `favoriteConditionLabel`.)
 */

/** The exact JSON the S3 endpoint returns (raw data; the islands derive es-MX copy). */
export interface HomePersonalization {
  recentFavorites: RecentFavorite[]
  /** Buyer + seller pending offers; the island runs `deriveOfferAlerts` for the copy. */
  offerAlertInputs: OfferAlertInput[]
  sellerSnapshot: { shopName: string; visitas: number; ofertasNuevas: number } | null
  hasShop: boolean
}

/**
 * Price label for the retoma rail (a `RecentFavorite` carries cents + currency, not a
 * `Listing`). Lifted verbatim from the pre-S2 `app/page.tsx`.
 */
export function priceLabel(cents: number | null, currency: string): string {
  if (cents == null) return 'Precio a consultar'
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100)
  } catch {
    // A malformed/missing currency code from the wire would throw a RangeError and blank
    // the whole client render — degrade to a plain amount instead.
    return new Intl.NumberFormat('es-MX').format(cents / 100)
  }
}

/**
 * es-MX condition label — the next-free twin of `lib/listings.ts conditionLabel`
 * (which can't be imported client-side). Same map; `null`/unknown degrade safely.
 */
export function favoriteConditionLabel(condition: string | null): string {
  const map: Record<string, string> = {
    new: 'Nuevo',
    like_new: 'Como nuevo',
    good: 'Buen estado',
    fair: 'Aceptable',
    parts: 'Para piezas',
  }
  return condition ? (map[condition] ?? condition) : ''
}

/**
 * Which seller module the signed-in homepage shows: the "Tu tienda esta semana"
 * snapshot when the user has a shop with stats, else the "¿Vendes algo?" recruit card.
 * (Pre-S2 this was an inline ternary on `hasShop && sellerSnapshot`.)
 */
export function sellerModule(p: {
  hasShop: boolean
  sellerSnapshot: HomePersonalization['sellerSnapshot']
}): 'snapshot' | 'recruit' {
  return p.hasShop && p.sellerSnapshot ? 'snapshot' : 'recruit'
}
