import { notFound, permanentRedirect } from 'next/navigation'
import { getShop } from '@/lib/listings'
import { assertShopNotPreviewPrivate, isShopPreviewPrivateBySlug } from '@/lib/preview-access'
import { isLikelyShopSlug } from '@/lib/route-shape'
import { getSlugRedirect } from '@/lib/slug-redirect'
import CollectionPage from '../../../../_shop-collection/CollectionPage'
import { readPublicSellerMarket } from '@/lib/owned-market'
import type { MarketCode } from '@/lib/markets'
import type { Metadata } from 'next'

export async function generateShopCollectionMetadata({
  params,
  market,
  marketBasePath = '',
}: {
  params: Promise<{ slug: string; collection: string }>
  market?: MarketCode
  marketBasePath?: string
}): Promise<Metadata> {
  const { slug, collection } = await params
  const missingTitle = market === 'us' ? 'Collection not found' : 'Colección no encontrada'
  if (!isLikelyShopSlug(slug)) return { title: missingTitle }
  const shop = await getShop(slug, market)
  if (!shop) return { title: missingTitle }
  if (market && readPublicSellerMarket(shop)?.market_code !== market) {
    return { title: missingTitle }
  }
  // Don't leak a preview-private shop's name in the <title>. Guarded explicitly
  // rather than relying on Next discarding metadata when the body notFound()s —
  // that behavior was asserted in review but never actually verified.
  if (await isShopPreviewPrivateBySlug(shop.slug, shop.clerk_user_id)) return { title: market === 'us' ? 'Page not found' : 'Página no encontrada' }
  return {
    title: `${market === 'us' ? 'Collection' : 'Colección'} — ${shop.name}`,
    ...(marketBasePath ? {
      alternates: {
        canonical: `https://miyagisanchez.com${marketBasePath}/s/${slug}/c/${collection}`,
      },
    } : {}),
  }
}

export const generateMetadata = generateShopCollectionMetadata

// Marketplace path: /s/[slug]/c/[collection]. On subdomain/custom domain this
// route is never reached (middleware's boundary-isolation deny-list redirects
// /s/* home there) — the channel path is app/(shell)/c/[collection]/page.tsx.
export async function ShopCollectionPage({
  params,
  market,
  marketBasePath = '',
}: {
  params: Promise<{ slug: string; collection: string }>
  market?: MarketCode
  marketBasePath?: string
}) {
  const { slug, collection } = await params
  if (!isLikelyShopSlug(slug)) notFound()
  const shop = await getShop(slug, market)
  if (!shop) {
    const current = await getSlugRedirect(slug)
    if (current) permanentRedirect(`${marketBasePath}/s/${current}/c/${collection}`)
    notFound()
  }
  if (market && readPublicSellerMarket(shop)?.market_code !== market) notFound()
  // Consent-safe previews: never render a preview-private shop's shell.
  await assertShopNotPreviewPrivate(shop)

  return (
    <CollectionPage
      shop={shop}
      collectionShortSlug={collection}
      basePath={`${marketBasePath}/s/${shop.slug}`}
      isMarketplaceRoute
      market={market}
      marketBasePath={marketBasePath}
    />
  )
}

export default ShopCollectionPage
