import type { Listing, Shop } from '@/lib/types'
import type { HeroSettings } from '@/lib/shop-settings/types'
import { formatPrice } from '@/lib/listings'
import ClosetListingCard from './ClosetListingCard'

/**
 * Own-shop premium presentation (epic 07, Sprint 1, Story 1.2) — hero/featured
 * section between the shop header and the listings grid. Absent/empty `hero`
 * renders nothing (today's storefront, unchanged).
 *
 * `mode: 'listings'` filters the already-fetched `getShopListings()` result by
 * `pinned_listing_ids`, preserving pin order — a removed/unpublished listing
 * simply isn't in that array anymore, so it drops out for free (no dangling
 * reference to handle, no extra Medusa call).
 */
export default function HeroSection({
  hero,
  listings,
  shop,
  accent,
  sellerHasStripe,
  mpEnabled,
  hasClabe,
}: {
  hero: HeroSettings | null | undefined
  listings: Listing[]
  shop: Shop
  accent: string
  sellerHasStripe: boolean
  mpEnabled: boolean
  hasClabe: boolean
}) {
  if (!hero) return null

  if (hero.mode === 'listings') {
    const byId = new Map(listings.map(l => [l.id, l]))
    const pinned = (hero.pinned_listing_ids ?? [])
      .map(id => byId.get(id))
      .filter((l): l is Listing => !!l)
    if (pinned.length === 0) return null

    return (
      <div className="max-w-6xl mx-auto px-4 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {pinned.map(listing => (
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
                paymentMethods: { stripe: sellerHasStripe, mp: mpEnabled, spei: hasClabe },
                href: `/l/${listing.id}`,
                formattedPrice: formatPrice(listing),
                status: listing.status,
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (!hero.promo_image_url) return null

  return (
    <div className="max-w-6xl mx-auto px-4 mb-6">
      <div className="relative w-full aspect-[16/6] rounded-xl overflow-hidden">
        <img
          src={hero.promo_image_url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        {hero.promo_cta_text && (
          <div className="absolute inset-0 flex items-end p-4">
            <a
              href={hero.promo_cta_link ?? '#'}
              className="no-underline text-white text-sm font-semibold px-4 py-2 rounded-full"
              style={{ backgroundColor: accent }}
            >
              {hero.promo_cta_text}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
