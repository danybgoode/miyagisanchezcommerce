import { unstable_cache } from 'next/cache'
import { db } from '@/lib/supabase'
import { CACHE } from '@/lib/cache-policy'
import type { PrintSocialSubmission } from '@/lib/print'
import { getRecentListings } from '@/lib/listings'
import type { Listing, Shop } from '@/lib/types'
import {
  rankNeighborhoodListings,
  rankNeighborhoodShops,
  type NeighborhoodShopRankSignals,
} from '@/lib/neighborhood-rank'
import {
  isNeighborhoodPulseSocialItem,
  NEIGHBORHOOD_PULSE_COPY,
  NEIGHBORHOOD_PULSE_SOCIAL_STATUSES,
} from '@/lib/neighborhood-pulse'

export type NeighborhoodTrendingListing = Listing & {
  favorite_count: number
  trend_score: number
}

export type NeighborhoodSpotlightShop = {
  id: string
  slug: string
  name: string
  tagline: string
  colonia: string
  logo_url: string | null
  listing_count: number
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function latestDate(a: string, b: string): string {
  const at = new Date(a).getTime()
  const bt = new Date(b).getTime()
  if (!Number.isFinite(at)) return b
  if (!Number.isFinite(bt)) return a
  return bt > at ? b : a
}

function shopSettings(shop: Shop): Record<string, unknown> {
  return objectValue(objectValue(shop.metadata)?.settings) ?? {}
}

function shopTagline(shop: Shop): string {
  const theme = objectValue(shopSettings(shop).theme)
  return trimmedString(theme?.tagline)
    || trimmedString(shop.description)
    || NEIGHBORHOOD_PULSE_COPY.spotlightFallbackTagline
}

function shopColonia(shop: Shop): string {
  const shipping = objectValue(shopSettings(shop).shipping)
  const origin = objectValue(shipping?.origin_address)
  return trimmedString(origin?.colonia)
    || trimmedString(shop.location)
    || NEIGHBORHOOD_PULSE_COPY.spotlightFallbackColonia
}

// Cached so the (now-static) marketplace homepage has no uncached read forcing a
// per-request render — a coarse approved community feed, tolerant of ~5 min lag, so
// it rides the CATEGORY window from the lib/cache-policy.ts SSOT. /vecindario benefits
// too (behavior-preserving). Keyed on `limit` so each caller's slice caches separately.
export const getNeighborhoodPulseItems = unstable_cache(
  async (limit = 24): Promise<PrintSocialSubmission[]> => {
    const { data, error } = await db
      .from('print_social_submissions')
      .select('*')
      .in('status', [...NEIGHBORHOOD_PULSE_SOCIAL_STATUSES])
      .eq('web_visible', true)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[neighborhood-pulse] feed unavailable:', error.message)
      return []
    }

    return ((data ?? []) as PrintSocialSubmission[])
      .filter(isNeighborhoodPulseSocialItem)
      .slice(0, limit)
  },
  ['neighborhood-pulse-items'],
  { revalidate: CACHE.CATEGORY, tags: ['pulse'] },
)

async function favoriteCountsForListings(listings: Listing[]): Promise<Map<string, number>> {
  const medusaIds = listings.map((listing) => listing.id).filter(Boolean)
  if (medusaIds.length === 0) return new Map()

  const { data: mapped, error: listingError } = await db
    .from('marketplace_listings')
    .select('id, medusa_product_id')
    .in('medusa_product_id', medusaIds)

  if (listingError || !mapped?.length) return new Map()

  const listingIdToMedusa = new Map<string, string>()
  for (const row of mapped as Array<{ id: string; medusa_product_id: string | null }>) {
    if (row.medusa_product_id) listingIdToMedusa.set(row.id, row.medusa_product_id)
  }

  const { data: favorites, error: favoriteError } = await db
    .from('marketplace_favorites')
    .select('listing_id')
    .in('listing_id', [...listingIdToMedusa.keys()])

  if (favoriteError || !favorites?.length) return new Map()

  const counts = new Map<string, number>()
  for (const favorite of favorites as Array<{ listing_id: string }>) {
    const medusaId = listingIdToMedusa.get(favorite.listing_id)
    if (!medusaId) continue
    counts.set(medusaId, (counts.get(medusaId) ?? 0) + 1)
  }
  return counts
}

async function recentListingCandidates(limit: number): Promise<Listing[]> {
  try {
    return await withTimeout(getRecentListings(limit), 2_500, [])
  } catch (error) {
    console.warn('[neighborhood-pulse] catalog unavailable:', error)
    return []
  }
}

export async function getTrendingNeighborhoodListings(limit = 8): Promise<NeighborhoodTrendingListing[]> {
  const candidates = await recentListingCandidates(Math.max(limit * 4, 24))
  if (candidates.length === 0) return []

  const favoriteCounts = await favoriteCountsForListings(candidates)
  return rankNeighborhoodListings(
    candidates.map((listing) => ({
      ...listing,
      favorite_count: favoriteCounts.get(listing.id) ?? 0,
    })),
  ).slice(0, limit)
}

export async function getNeighborhoodSpotlightShops(limit = 6): Promise<NeighborhoodSpotlightShop[]> {
  const candidates = await recentListingCandidates(Math.max(limit * 8, 36))
  if (candidates.length === 0) return []

  const byShop = new Map<string, NeighborhoodShopRankSignals & {
    shop: Shop
    latest_listing_at: string
    listing_count: number
    view_count: number
  }>()

  for (const listing of candidates) {
    const shop = listing.shop
    if (!shop?.slug) continue

    const current = byShop.get(shop.slug)
    if (!current) {
      byShop.set(shop.slug, {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        created_at: shop.created_at ?? listing.created_at,
        latest_listing_at: listing.created_at,
        listing_count: 1,
        view_count: Math.max(0, Number(listing.views ?? 0)),
        shop,
      })
      continue
    }

    current.latest_listing_at = latestDate(current.latest_listing_at, listing.created_at)
    current.listing_count += 1
    current.view_count += Math.max(0, Number(listing.views ?? 0))
  }

  return rankNeighborhoodShops([...byShop.values()])
    .slice(0, limit)
    .map((ranked) => ({
      id: ranked.id,
      slug: ranked.slug,
      name: ranked.name,
      tagline: shopTagline(ranked.shop),
      colonia: shopColonia(ranked.shop),
      logo_url: ranked.shop.logo_url,
      listing_count: ranked.listing_count,
    }))
}
