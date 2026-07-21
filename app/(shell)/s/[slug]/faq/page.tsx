import { notFound, permanentRedirect } from 'next/navigation'
import { getShop } from '@/lib/listings'
import { assertShopNotPreviewPrivate, isShopPreviewPrivateBySlug } from '@/lib/preview-access'
import { isLikelyShopSlug } from '@/lib/route-shape'
import { getSlugRedirect } from '@/lib/slug-redirect'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import FaqBody from '../../../_shop-content/FaqBody'
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
  // Don't leak a preview-private shop's name in the <title>. Guarded explicitly
  // rather than relying on Next discarding metadata when the body notFound()s —
  // that behavior was asserted in review but never actually verified.
  if (await isShopPreviewPrivateBySlug(shop.slug, shop.clerk_user_id)) return { title: 'Página no encontrada' }
  return { title: `Preguntas frecuentes — ${shop.name}` }
}

// Marketplace path: /s/[slug]/faq. On subdomain/custom domain this route is
// never reached (middleware's boundary-isolation deny-list redirects /s/*
// home there) — the channel path is app/(shell)/faq/page.tsx.
export default async function ShopFaqPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!isLikelyShopSlug(slug)) notFound()
  const shop = await getShop(slug)
  if (!shop) {
    const current = await getSlugRedirect(slug)
    if (current) permanentRedirect(`/s/${current}/faq`)
    notFound()
  }
  // Consent-safe previews: never render a preview-private shop's shell.
  await assertShopNotPreviewPrivate(shop)

  const domain = await getActiveCustomDomain(shop.slug)
  if (domain) permanentRedirect(`https://${domain}/faq`)

  return <FaqBody shop={shop} basePath={`/s/${shop.slug}`} />
}
