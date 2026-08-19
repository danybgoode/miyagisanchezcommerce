import 'server-only'

/**
 * Living Shop — the canonical object resolver (epic 07, Story 1.3).
 *
 * ONE place turns a Wall `reference_id` into something renderable, and it always
 * re-reads the canonical system (epic D3). The Wall row never carries price,
 * availability, collection membership or event details, so there is nothing here
 * that can go stale — a card either reflects the object as it is right now, or it
 * disappears.
 *
 * BATCHED ON PURPOSE (S7.4). A per-entry resolver would issue one Medusa call per
 * card, so a 12-entry Wall would cost 12 round trips and grow with the merchant's
 * output. Instead the shop's catalog, its collections and the referenced events
 * are each fetched ONCE per render and indexed in memory. The cost of a Wall page
 * is therefore three reads, not N.
 *
 * `unavailable` is a real answer, never an empty one. A reference whose object is
 * gone, unpublished or foreign resolves to `{ state: 'unavailable', reason }` —
 * collapsing that into "no reference" would make a broken card indistinguishable
 * from a plain post, which is precisely the confident falsehood the house rules
 * name.
 */

import { db } from '@/lib/supabase'
import { getShopListings, getShopCollections } from '@/lib/listings'
import type { Listing } from '@/lib/types'
import type { MarketplaceEvent } from '@/lib/events-types'
import type { WallEntry, PublicWallEntry, WallReferenceResolution } from './types'
import { effectiveInstant } from './visibility'
// The pure mapping half lives in `views.ts` so specs can reach it — this module
// carries `server-only` and would drag `next/cache` into any spec that imported it.
import { toProductView, toCollectionView, toEventView } from './views'
export { toProductView, toCollectionView, toEventView, COLLECTION_SAMPLE_SIZE } from './views'

// ── The batched shell ────────────────────────────────────────────────────────

export interface WallResolutionContext {
  shopId: string
  shopSlug: string
  /** Where the SHOP's routes live: `''` on an owned host, `/mx/s/<slug>` otherwise. */
  basePath: string
  /** Where a PRODUCT lives: `''` on an owned host, `/mx` on the marketplace. */
  listingBase: string
  locale: string
  now: Date
}

/**
 * Resolve every reference on a page of entries. Ownership is structural rather
 * than checked: the catalog and collection reads are already scoped to
 * `shopSlug`, and the event read is scoped to `shopId` — so a foreign id simply
 * is not in the index and resolves `unavailable`/`foreign`. There is no branch
 * that could be forgotten.
 */
export async function resolveWallEntries(
  entries: WallEntry[],
  ctx: WallResolutionContext,
): Promise<PublicWallEntry[]> {
  const needs = (kind: WallEntry['kind']) => entries.some((e) => e.kind === kind && e.reference_id)

  const [listings, collections, events] = await Promise.all([
    needs('product') || needs('collection') ? getShopListings(ctx.shopSlug) : Promise.resolve([] as Listing[]),
    needs('collection') ? getShopCollections(ctx.shopSlug) : Promise.resolve([] as Array<{ id: string; handle: string; name: string; sort_order: number }>),
    needs('event') ? fetchShopEvents(ctx.shopId, entries) : Promise.resolve([] as MarketplaceEvent[]),
  ])

  const byProductId = new Map(listings.map((l) => [l.id, l]))
  const byCollectionHandle = new Map(collections.map((c) => [c.handle, c]))
  const byEventSlug = new Map(events.map((e) => [e.slug, e]))

  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    body: entry.body,
    media: entry.media,
    pinned: entry.pinned,
    // Every entry reaching here is publicly visible, so it has an instant. The
    // fallback exists only so the type is honest, not because it can happen.
    effective_at: effectiveInstant(entry) ?? entry.created_at,
    reference: resolveOne(entry, { byProductId, byCollectionHandle, byEventSlug }, ctx),
  }))
}

function resolveOne(
  entry: WallEntry,
  index: {
    byProductId: Map<string, Listing>
    byCollectionHandle: Map<string, { handle: string; name: string }>
    byEventSlug: Map<string, MarketplaceEvent>
  },
  ctx: WallResolutionContext,
): WallReferenceResolution {
  if (entry.kind === 'post' || !entry.reference_id) return { state: 'none' }

  if (entry.kind === 'product') {
    const listing = index.byProductId.get(entry.reference_id)
    if (!listing) return { state: 'unavailable', reason: 'missing' }
    // `getShopListings` is the owned-channel read: it already excludes drafts, so
    // a listing present here is published. Re-checking keeps the rule visible at
    // the point it matters rather than relying on a distant function's behaviour.
    if (listing.status && listing.status !== 'active') return { state: 'unavailable', reason: 'unpublished' }
    return { state: 'product', product: toProductView(listing, { shopBase: ctx.basePath, listingBase: ctx.listingBase }, ctx.locale) }
  }

  if (entry.kind === 'collection') {
    const collection = index.byCollectionHandle.get(entry.reference_id)
    if (!collection) return { state: 'unavailable', reason: 'missing' }
    const members = [...index.byProductId.values()].filter((l) => (l.collections ?? []).includes(collection.handle))
    // A collection whose products are all gone is an empty shelf — nothing to
    // shop, so the card goes rather than linking to a blank page.
    if (members.length === 0) return { state: 'unavailable', reason: 'unpublished' }
    return { state: 'collection', collection: toCollectionView(collection, members, { shopBase: ctx.basePath, listingBase: ctx.listingBase }) }
  }

  const event = index.byEventSlug.get(entry.reference_id)
  if (!event) return { state: 'unavailable', reason: 'foreign' }
  return { state: 'event', event: toEventView(event, ctx.now) }
}

/**
 * Referenced events for one shop. Scoped by `shop_id` AND by the exact slugs the
 * Wall asks for, so another seller's event with the same slug cannot appear —
 * the `foreign` reason above is what a miss means, because a slug that exists
 * globally but not under this shop is exactly a cross-shop reference.
 */
async function fetchShopEvents(shopId: string, entries: WallEntry[]): Promise<MarketplaceEvent[]> {
  const slugs = [...new Set(entries.filter((e) => e.kind === 'event' && e.reference_id).map((e) => e.reference_id as string))]
  if (slugs.length === 0) return []
  const { data, error } = await db
    .from('marketplace_events')
    .select('*')
    .eq('shop_id', shopId)
    .in('slug', slugs)
  if (error) {
    // Degrade, never die: one unreachable source must not blank the whole Wall.
    // Every event card resolves `foreign` and says so; the posts still render.
    console.error('[wall] event resolution unavailable:', error.message)
    return []
  }
  return (data ?? []) as MarketplaceEvent[]
}

// ── Write-time ownership proofs (epic D3) ────────────────────────────────────
// The validator checks shape; these check that the referenced object is the
// caller's. They name the SAME identifier the renderer consumes — `reference_id`
// — because a check on one id and an effect on another is decoration.

export async function ownsProduct(shopSlug: string, productId: string): Promise<boolean> {
  const listings = await getShopListings(shopSlug)
  return listings.some((l) => l.id === productId)
}

export async function ownsCollection(shopSlug: string, handle: string): Promise<boolean> {
  const collections = await getShopCollections(shopSlug)
  return collections.some((c) => c.handle === handle)
}

export async function ownsEvent(shopId: string, slug: string): Promise<boolean> {
  const { data } = await db
    .from('marketplace_events')
    .select('id')
    .eq('shop_id', shopId)
    .eq('slug', slug)
    .maybeSingle()
  return !!data
}

/** One entry point the write paths share, so neither can forget a kind. */
export async function referenceBelongsToShop(
  kind: WallEntry['kind'],
  referenceId: string | null,
  shop: { id: string; slug: string },
): Promise<boolean> {
  if (kind === 'post') return referenceId === null
  if (!referenceId) return false
  if (kind === 'product') return ownsProduct(shop.slug, referenceId)
  if (kind === 'collection') return ownsCollection(shop.slug, referenceId)
  return ownsEvent(shop.id, referenceId)
}
