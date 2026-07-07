import { notFound, permanentRedirect } from 'next/navigation'
import Link from 'next/link'
import { getShopListings, getShopCollections, formatPrice } from '@/lib/listings'
import { isLikelyCollectionSlug } from '@/lib/route-shape'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import { shortCollectionSlug } from '@/lib/collection-derive'
import { readableTextOn } from '@/lib/platform-theme'
import AnnouncementBar from '../s/[slug]/AnnouncementBar'
import ShopCollectionNav from '../s/[slug]/ShopCollectionNav'
import ClosetListingCard from '../s/[slug]/ClosetListingCard'
import type { AnnouncementSettings } from '@/lib/shop-settings/types'
import type { Shop } from '@/lib/types'

/**
 * Shared body for both collection-page routes (own-shop premium
 * presentation, Sprint 2):
 *  - `app/(shell)/s/[slug]/c/[collection]/page.tsx` — marketplace path.
 *  - `app/(shell)/c/[collection]/page.tsx` — channel path (subdomain/custom
 *    domain), shop already resolved from the unspoofable
 *    `x-miyagi-shop-slug` header.
 *
 * `isMarketplaceRoute` gates the custom-domain SEO redirect — only the
 * marketplace path needs to 308 a live-domain shop's legacy URL onward; the
 * channel path is already on the tenant's own domain by construction.
 */
export default async function CollectionPage({
  shop,
  collectionShortSlug,
  basePath,
  isMarketplaceRoute,
}: {
  shop: Shop
  collectionShortSlug: string
  basePath: string
  isMarketplaceRoute: boolean
}) {
  // Cheap shape guard before any Medusa fetch (mirrors isLikelyShopSlug/
  // isLikelyListingId's role on the sibling routes).
  if (!isLikelyCollectionSlug(collectionShortSlug)) notFound()

  const collections = await getShopCollections(shop.slug)
  const matched = collections.find((c) => shortCollectionSlug(c.handle, shop.slug) === collectionShortSlug)
  // A foreign shop's collection handle, or a genuinely nonexistent one, is
  // simply absent from THIS shop's own collection list — this lookup IS the
  // per-shop isolation check (scoped by shop.slug, never trusts the raw id).
  if (!matched) notFound()

  if (isMarketplaceRoute) {
    const domain = await getActiveCustomDomain(shop.slug)
    if (domain) permanentRedirect(`https://${domain}/c/${collectionShortSlug}`)
  }

  // Compose downstream of the already print-placement-filtered listing read
  // — never re-query Medusa directly or reimplement that exclusion.
  const allListings = await getShopListings(shop.slug)
  const listings = allListings.filter((l) => l.collections?.includes(matched.handle))

  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const theme = (settings.theme ?? {}) as { accent_color?: string | null }
  const announcement = settings.announcement as AnnouncementSettings | null | undefined
  const themePreset = settings.theme_preset as string | null | undefined
  const accent = theme.accent_color ?? 'var(--color-accent)'
  const accentTextColor = readableTextOn(theme.accent_color ?? undefined)
  const mpEnabled = ((shop.metadata as Record<string, unknown> | null)?.mp_enabled as boolean | undefined) !== false
  const stripeSettings = (settings.stripe ?? {}) as { enabled?: boolean; charges_enabled?: boolean; account_id?: string }
  const sellerHasStripe = !!(stripeSettings.enabled !== false && stripeSettings.charges_enabled && stripeSettings.account_id)

  return (
    <div data-shop-preset={themePreset || undefined}>
      <AnnouncementBar announcement={announcement} textColor={accentTextColor} />

      <div className="max-w-6xl mx-auto px-4 pt-6 pb-2">
        <Link href={basePath || '/'} className="text-sm text-[var(--color-muted)] no-underline hover:underline">
          ← {shop.name}
        </Link>
        <h1 className="text-xl font-bold mt-1">{matched.name}</h1>
      </div>

      <ShopCollectionNav
        listings={allListings}
        collections={collections}
        basePath={basePath}
        sellerSlug={shop.slug}
        accent={accent}
        activeTextColor={accentTextColor}
        activeShortSlug={collectionShortSlug}
      />

      <div className="max-w-6xl mx-auto px-4 pb-12">
        {listings.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-muted)]">
            <div className="text-4xl mb-3">📦</div>
            <p className="font-medium">Esta colección todavía no tiene anuncios.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {listings.map((listing) => (
              <ClosetListingCard
                key={listing.id}
                accent={accent}
                item={{
                  productId: listing.id,
                  variantId: null,
                  sellerId: shop.id ?? '',
                  sellerSlug: shop.slug,
                  sellerName: shop.name,
                  title: listing.title,
                  price_cents: listing.price_cents ?? 0,
                  currency: listing.currency ?? 'MXN',
                  imageUrl: listing.images?.[0]?.url ?? null,
                  listing_type: listing.listing_type ?? 'product',
                  paymentMethods: { stripe: sellerHasStripe, mp: mpEnabled },
                  href: `/l/${listing.id}`,
                  formattedPrice: formatPrice(listing),
                  status: listing.status,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
