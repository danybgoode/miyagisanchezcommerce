import { getShopListings, formatPrice } from '@/lib/listings'
import { hasExcerpt } from '@/lib/excerpt'
import { publicShopPaymentAvailability } from '@/lib/public-shop-commerce'
import ClosetListingCard from '@/app/(shell)/s/[slug]/ClosetListingCard'
import ShopSectionNav from './ShopSectionNav'
import ShopCollectionNav from '@/app/(shell)/s/[slug]/ShopCollectionNav'
import { getDictionary } from '@/lib/dictionary'
import { resolveMarketPresentation } from '@/lib/market-presentation'
import { readPublicSellerMarket } from '@/lib/owned-market'
import type { ShopPresentationContext } from '@/lib/shop-presentation/context'

/**
 * Living Shop — the Shop index (epic 07, Story 3.3).
 *
 * The complete public catalog, as a destination of its own. The Wall is the
 * homepage narrative and it is chronological by nature, so without this route a
 * merchant's older products would only be reachable by scrolling a story —
 * "the Wall never becomes the only route to products" is this page's whole
 * reason to exist.
 *
 * The collection chips live HERE rather than on the homepage: on a catalog they
 * are a filter, which is what they always were; on the homepage they were a
 * second nav competing with the section nav (Story 3.2).
 */

export default async function ShopIndexBody({ ctx }: { ctx: ShopPresentationContext }) {
  const market = readPublicSellerMarket(ctx.shop)?.market_code ?? 'mx'
  const presentation = resolveMarketPresentation(market)
  const dict = await getDictionary(presentation.language)
  const copy = dict.buyerCopy

  const listings = await getShopListings(ctx.shop.slug)
  const payments = publicShopPaymentAvailability(ctx.shop.metadata)

  return (
    <div className="pb-12">
      <ShopSectionNav
        config={ctx.sections}
        availability={ctx.availability}
        basePath={ctx.basePath}
        active="shop"
        accent={ctx.accent}
        activeTextColor={ctx.accentTextColor}
        copy={copy}
      />

      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-xl font-bold mb-4">{copy['shopSections.shopTitle']}</h1>

        <ShopCollectionNav
          listings={listings}
          collections={ctx.collections}
          basePath={ctx.basePath}
          sellerSlug={ctx.shop.slug}
          accent={ctx.accent}
          activeTextColor={ctx.accentTextColor}
          activeShortSlug={null}
        />

        {listings.length === 0 ? (
          <p className="text-center py-16 text-[var(--color-muted)]">{copy['shopSections.shopEmpty']}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {listings.map((listing) => (
              <ClosetListingCard
                key={listing.id}
                accent={ctx.accent}
                item={{
                  productId: listing.id,
                  variantId: null,
                  sellerId: ctx.shop.id ?? '',
                  sellerSlug: ctx.shop.slug,
                  sellerName: ctx.shop.name,
                  title: listing.title,
                  price_cents: listing.price_cents ?? 0,
                  currency: listing.currency ?? 'MXN',
                  imageUrl: listing.images?.[0]?.url ?? null,
                  listing_type: listing.listing_type ?? 'product',
                  paymentMethods: { stripe: payments.stripe, mp: payments.mercadopago, spei: payments.bankTransfer },
                  href: `${ctx.basePath}/l/${listing.id}`,
                  formattedPrice: formatPrice(listing, presentation.htmlLang),
                  status: listing.status,
                  hasExcerpt: hasExcerpt(listing.metadata),
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
