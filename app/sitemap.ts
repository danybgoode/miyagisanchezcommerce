import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getShopListings, getShopCollections } from '@/lib/listings'
import { shortCollectionSlug } from '@/lib/collection-derive'

/**
 * Host-aware sitemap.
 *
 * On a tenant's custom domain (tagged by middleware with the resolved shop slug)
 * we emit THAT shop's storefront — home + every product — under the custom
 * domain, so search engines index the brand domain as an independent store and
 * avoid duplicate-content penalties against the marketplace mirror.
 *
 * On the platform host we emit a small marketplace sitemap (key entry points
 * only — we deliberately don't enumerate the full multi-seller catalog here).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers()
  const shopSlug = h.get('x-miyagi-shop-slug')
  const domain = h.get('x-miyagi-domain')

  if (shopSlug && domain) {
    const base = `https://${domain.split(':')[0]}`
    // Never 500 the sitemap on a backend hiccup — fall back to just the home URL.
    let listings: Awaited<ReturnType<typeof getShopListings>> = []
    let collections: Awaited<ReturnType<typeof getShopCollections>> = []
    try {
      [listings, collections] = await Promise.all([
        getShopListings(shopSlug),
        getShopCollections(shopSlug),
      ])
    } catch {
      listings = []
      collections = []
    }
    return [
      { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
      ...listings.map((l) => ({
        url: `${base}/l/${l.id}`,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
      ...collections.map((c) => ({
        url: `${base}/c/${shortCollectionSlug(c.handle, shopSlug)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ]
  }

  const base = 'https://miyagisanchez.com'
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/l`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/acerca`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/vende`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/vende/creadores`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/vende/mundial`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/vende/negocios`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/vende/servicios`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/sell`, changeFrequency: 'monthly', priority: 0.5 },
  ]
}
