import { notFound, permanentRedirect } from 'next/navigation'
import { getShop } from '@/lib/listings'
import { assertShopNotPreviewPrivate, isShopPreviewPrivateBySlug } from '@/lib/preview-access'
import { isLikelyShopSlug } from '@/lib/route-shape'
import { getSlugRedirect } from '@/lib/slug-redirect'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { marketCatalogCanonical } from '@/lib/market-seo'
import PoliticasBody from '../../../_shop-content/PoliticasBody'
import type { MarketCode } from '@/lib/markets'
import type { Metadata } from 'next'

export const revalidate = 120

export async function generateShopPoliciesMetadata({
  params,
  market,
  marketBasePath = '',
}: {
  params: Promise<{ slug: string }>
  market?: MarketCode
  marketBasePath?: string
}): Promise<Metadata> {
  const { slug } = await params
  if (!isLikelyShopSlug(slug)) return { title: 'Página no encontrada' }
  const shop = await getShop(slug)
  if (!shop) return { title: 'Página no encontrada' }
  if (market && readPublicSellerMarket(shop)?.market_code !== market) {
    return { title: 'Página no encontrada' }
  }
  // Don't leak a preview-private shop's name in the <title>. Guarded explicitly
  // rather than relying on Next discarding metadata when the body notFound()s —
  // that behavior was asserted in review but never actually verified.
  if (await isShopPreviewPrivateBySlug(shop.slug, shop.clerk_user_id)) return { title: 'Página no encontrada' }
  return {
    title: `Políticas — ${shop.name}`,
    ...(marketBasePath ? marketCatalogCanonical(`${marketBasePath}/s/${slug}/politicas`) : {}),
  }
}

export const generateMetadata = generateShopPoliciesMetadata

// Marketplace path: /s/[slug]/politicas. On subdomain/custom domain this route
// is never reached (middleware's boundary-isolation deny-list redirects /s/*
// home there) — the channel path is app/(shell)/politicas/page.tsx.
export async function ShopPoliticasPage({
  params,
  market,
  marketBasePath = '',
}: {
  params: Promise<{ slug: string }>
  market?: MarketCode
  marketBasePath?: string
}) {
  const { slug } = await params
  if (!isLikelyShopSlug(slug)) notFound()
  const shop = await getShop(slug)
  if (!shop) {
    const current = await getSlugRedirect(slug)
    if (current) permanentRedirect(`${marketBasePath}/s/${current}/politicas`)
    notFound()
  }
  if (market && readPublicSellerMarket(shop)?.market_code !== market) notFound()
  // Consent-safe previews: never render a preview-private shop's shell.
  await assertShopNotPreviewPrivate(shop)

  if (!marketBasePath) {
    const domain = await getActiveCustomDomain(shop.slug)
    if (domain) permanentRedirect(`https://${domain}/politicas`)
  }

  return <PoliticasBody shop={shop} basePath={`${marketBasePath}/s/${shop.slug}`} />
}

export default ShopPoliticasPage
