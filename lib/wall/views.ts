/**
 * Living Shop — the pure card views (epic 07, Story 1.3 / Sprint 2).
 *
 * Split out of `lib/wall/resolve.ts` for the reason AGENTS.md names: the pure
 * half (decide, map, format) is what gets tested, and the I/O shell (fetch,
 * index, batch) is what cannot be. `resolve.ts` carries `server-only` and pulls
 * in `next/cache` through `lib/listings`, so anything left inside it is
 * unreachable from a spec — which is how a mapping rule ends up untested.
 *
 * Next-free. No `server-only`. No imports that touch the framework.
 */

import type { Listing } from '@/lib/types'
import type { MarketplaceEvent } from '@/lib/events-types'
import type { WallProductView, WallCollectionView, WallEventView } from './types'

/** A bounded sample is a design decision, not a query limit — 4 tiles fit one row. */
export const COLLECTION_SAMPLE_SIZE = 4

/**
 * Price for a Wall card.
 *
 * Deliberately NOT `formatPrice` from `lib/listings`: that returns a "price on
 * request" SENTENCE for a priceless listing, which a card must not paint as a
 * price. Here the absence is `null` and the card decides how to render nothing —
 * three states (a price, no price, and later a sold-out flag), never two.
 */
export function wallPrice(listing: Pick<Listing, 'price_cents' | 'currency'>, locale: string): string | null {
  if (listing.price_cents == null) return null
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: listing.currency ?? 'MXN',
  }).format(listing.price_cents / 100)
}

export function toProductView(listing: Listing, basePath: string, locale: string): WallProductView {
  return {
    id: listing.id,
    title: listing.title,
    href: `${basePath}/l/${listing.id}`,
    imageUrl: listing.images?.[0]?.url ?? null,
    formattedPrice: wallPrice(listing, locale),
    // `in_stock` is false only when Medusa is actually managing inventory and it
    // ran out. Undefined means "not tracked", which is available.
    available: listing.in_stock !== false,
  }
}

export function toCollectionView(
  collection: { handle: string; name: string },
  members: Listing[],
  basePath: string,
): WallCollectionView {
  return {
    handle: collection.handle,
    name: collection.name,
    href: `${basePath}/c/${collection.handle}`,
    productCount: members.length,
    sample: members.slice(0, COLLECTION_SAMPLE_SIZE).map((l) => ({
      id: l.id,
      title: l.title,
      imageUrl: l.images?.[0]?.url ?? null,
      href: `${basePath}/l/${l.id}`,
    })),
  }
}

export function toEventView(event: MarketplaceEvent, now: Date): WallEventView {
  const startsMs = Date.parse(event.starts_at)
  return {
    slug: event.slug,
    title: event.title,
    // The public event page lives at the platform root on every channel — an
    // event is a real-world invitation, not a shop-scoped catalog object.
    href: `/e/${event.slug}`,
    startsAt: event.starts_at,
    venueName: event.venue_name,
    cancelled: event.status === 'cancelled',
    past: Number.isFinite(startsMs) && startsMs < now.getTime(),
  }
}
