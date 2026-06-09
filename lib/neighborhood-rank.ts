export interface NeighborhoodRankSignals {
  id: string
  created_at: string
  views?: number | null
  favorite_count?: number | null
}

export interface NeighborhoodRanked {
  trend_score: number
}

export interface NeighborhoodShopRankSignals {
  id: string
  slug: string
  name: string
  created_at: string
  latest_listing_at?: string | null
  listing_count?: number | null
  view_count?: number | null
  order_count?: number | null
}

export interface NeighborhoodShopRanked {
  spotlight_score: number
}

function positiveNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function neighborhoodRecencyScore(createdAt: string, now = Date.now()): number {
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return 0
  const ageHours = Math.max(0, (now - created) / 3_600_000)
  return 1 / (1 + ageHours / 24)
}

export function neighborhoodTrendScore(item: NeighborhoodRankSignals, now = Date.now()): number {
  const views = positiveNumber(item.views)
  const favorites = positiveNumber(item.favorite_count)
  return Math.log1p(favorites) * 8
    + Math.log1p(views) * 2
    + neighborhoodRecencyScore(item.created_at, now) * 5
}

export function rankNeighborhoodListings<T extends NeighborhoodRankSignals>(
  listings: T[],
  now = Date.now(),
): Array<T & NeighborhoodRanked> {
  return listings
    .map((listing) => ({ ...listing, trend_score: neighborhoodTrendScore(listing, now) }))
    .sort((a, b) => {
      const scoreDiff = b.trend_score - a.trend_score
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff
      const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (Number.isFinite(dateDiff) && dateDiff !== 0) return dateDiff
      return a.id.localeCompare(b.id)
    })
}

export function neighborhoodShopSpotlightScore(shop: NeighborhoodShopRankSignals, now = Date.now()): number {
  const orders = positiveNumber(shop.order_count)
  const listings = positiveNumber(shop.listing_count)
  const views = positiveNumber(shop.view_count)
  const latestListing = shop.latest_listing_at ?? shop.created_at

  return Math.log1p(orders) * 14
    + Math.log1p(listings) * 6
    + Math.log1p(views) * 2
    + neighborhoodRecencyScore(latestListing, now) * 6
    + neighborhoodRecencyScore(shop.created_at, now) * 2
}

export function rankNeighborhoodShops<T extends NeighborhoodShopRankSignals>(
  shops: T[],
  now = Date.now(),
): Array<T & NeighborhoodShopRanked> {
  return shops
    .map((shop) => ({ ...shop, spotlight_score: neighborhoodShopSpotlightScore(shop, now) }))
    .sort((a, b) => {
      const scoreDiff = b.spotlight_score - a.spotlight_score
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff

      const latestA = new Date(a.latest_listing_at ?? a.created_at).getTime()
      const latestB = new Date(b.latest_listing_at ?? b.created_at).getTime()
      const latestDiff = latestB - latestA
      if (Number.isFinite(latestDiff) && latestDiff !== 0) return latestDiff

      const nameDiff = a.name.localeCompare(b.name, 'es')
      if (nameDiff !== 0) return nameDiff
      return a.slug.localeCompare(b.slug)
    })
}
