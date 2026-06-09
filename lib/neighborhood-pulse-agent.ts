import {
  getNeighborhoodPulseItems,
  getNeighborhoodSpotlightShops,
  getTrendingNeighborhoodListings,
} from '@/lib/neighborhood-pulse-server'
import {
  NEIGHBORHOOD_PULSE_COPY,
  printSocialTypeLabel,
  publicSubmitterLabel,
} from '@/lib/neighborhood-pulse'
import { toUcpListing, type UcpListing } from '@/lib/ucp/schema'

export type NeighborhoodPulseAgentItem = {
  id: string
  type: string
  type_label: string
  caption: string
  body: string | null
  photos: string[]
  zone: string
  submitter_label: string
  created_at: string
}

export type NeighborhoodPulseAgentShop = {
  id: string
  slug: string
  name: string
  tagline: string
  colonia: string
  logo_url: string | null
  url: string
  listing_count: number
  view_count: number
  order_count: number
  spotlight_score: number
}

export type NeighborhoodPulseAgentView = {
  community_items: NeighborhoodPulseAgentItem[]
  trending_listings: UcpListing[]
  spotlight_shops: NeighborhoodPulseAgentShop[]
  _meta: {
    view: 'neighborhood_pulse'
    read_only: true
    locale: 'es-MX'
  }
}

export async function getNeighborhoodPulseAgentView(
  baseUrl: string,
  options: { itemLimit?: number; listingLimit?: number; shopLimit?: number } = {},
): Promise<NeighborhoodPulseAgentView> {
  const itemLimit = Math.min(Math.max(1, Number(options.itemLimit ?? 12)), 24)
  const listingLimit = Math.min(Math.max(1, Number(options.listingLimit ?? 8)), 20)
  const shopLimit = Math.min(Math.max(1, Number(options.shopLimit ?? 6)), 12)

  const [items, trending, spotlight] = await Promise.all([
    getNeighborhoodPulseItems(itemLimit),
    getTrendingNeighborhoodListings(listingLimit),
    getNeighborhoodSpotlightShops(shopLimit),
  ])

  return {
    community_items: items.map((item) => ({
      id: item.id,
      type: item.type,
      type_label: printSocialTypeLabel(item.type),
      caption: item.caption,
      body: item.body,
      photos: Array.isArray(item.photos) ? item.photos.filter(Boolean) : [],
      zone: item.zone?.trim() || NEIGHBORHOOD_PULSE_COPY.fallbackZone,
      submitter_label: publicSubmitterLabel(item),
      created_at: item.created_at,
    })),
    trending_listings: trending.map((listing) => toUcpListing(listing, baseUrl)),
    spotlight_shops: spotlight.map((shop) => ({
      id: shop.id,
      slug: shop.slug,
      name: shop.name,
      tagline: shop.tagline,
      colonia: shop.colonia,
      logo_url: shop.logo_url,
      url: `${baseUrl}/s/${shop.slug}`,
      listing_count: shop.listing_count,
      view_count: shop.view_count,
      order_count: shop.order_count,
      spotlight_score: shop.spotlight_score,
    })),
    _meta: {
      view: 'neighborhood_pulse',
      read_only: true,
      locale: 'es-MX',
    },
  }
}
