import { notFound, permanentRedirect } from 'next/navigation'
import { getShop } from '@/lib/listings'
import { assertShopNotPreviewPrivate } from '@/lib/preview-access'
import { isLikelyShopSlug } from '@/lib/route-shape'
import { getSlugRedirect } from '@/lib/slug-redirect'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import PoliticasBody from '../../../_shop-content/PoliticasBody'
import type { Metadata } from 'next'

export const revalidate = 120

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  if (!isLikelyShopSlug(slug)) return { title: 'Página no encontrada' }
  const shop = await getShop(slug)
  if (!shop) return { title: 'Página no encontrada' }
  return { title: `Políticas — ${shop.name}` }
}

// Marketplace path: /s/[slug]/politicas. On subdomain/custom domain this route
// is never reached (middleware's boundary-isolation deny-list redirects /s/*
// home there) — the channel path is app/(shell)/politicas/page.tsx.
export default async function ShopPoliticasPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!isLikelyShopSlug(slug)) notFound()
  const shop = await getShop(slug)
  if (!shop) {
    const current = await getSlugRedirect(slug)
    if (current) permanentRedirect(`/s/${current}/politicas`)
    notFound()
  }
  // Consent-safe previews: never render a preview-private shop's shell.
  await assertShopNotPreviewPrivate(shop.slug)

  const domain = await getActiveCustomDomain(shop.slug)
  if (domain) permanentRedirect(`https://${domain}/politicas`)

  return <PoliticasBody shop={shop} basePath={`/s/${shop.slug}`} />
}
