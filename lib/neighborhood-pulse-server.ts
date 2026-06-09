import { db } from '@/lib/supabase'
import type { PrintSocialSubmission } from '@/lib/print'
import { getRecentListings } from '@/lib/listings'
import type { Listing } from '@/lib/types'
import { rankNeighborhoodListings } from '@/lib/neighborhood-rank'
import {
  isNeighborhoodPulseSocialItem,
  NEIGHBORHOOD_PULSE_SOCIAL_STATUSES,
} from '@/lib/neighborhood-pulse'

export type NeighborhoodTrendingListing = Listing & {
  favorite_count: number
  trend_score: number
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

export async function getNeighborhoodPulseItems(limit = 24): Promise<PrintSocialSubmission[]> {
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
}

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

export async function getTrendingNeighborhoodListings(limit = 8): Promise<NeighborhoodTrendingListing[]> {
  const candidates = await withTimeout(getRecentListings(Math.max(limit * 4, 24)), 2_500, [])
  if (candidates.length === 0) return []

  const favoriteCounts = await favoriteCountsForListings(candidates)
  return rankNeighborhoodListings(
    candidates.map((listing) => ({
      ...listing,
      favorite_count: favoriteCounts.get(listing.id) ?? 0,
    })),
  ).slice(0, limit)
}
