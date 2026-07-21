import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getShop } from '@/lib/listings'
import { assertShopNotPreviewPrivate, isShopPreviewPrivateBySlug } from '@/lib/preview-access'
import CollectionPage from '../../_shop-collection/CollectionPage'
import type { Metadata } from 'next'

export const revalidate = 120

async function resolveChannelShop() {
  const channelSlug = (await headers()).get('x-miyagi-shop-slug')
  // No channel header ⇒ we're on the platform host, where this bare `/c/...`
  // segment has no meaning (the marketplace path is /s/[slug]/c/[collection])
  // — self-404 without a Medusa fetch. The header is set ONLY by
  // middleware.ts (never client-controllable), so this is a hard boundary,
  // not a spoofable one.
  if (!channelSlug) return null
  return getShop(channelSlug)
}

export async function generateMetadata(): Promise<Metadata> {
  const shop = await resolveChannelShop()
  if (!shop) return { title: 'Colección no encontrada' }
  // Don't leak a preview-private shop's name in the <title>. Guarded explicitly
  // rather than relying on Next discarding metadata when the body notFound()s —
  // that behavior was asserted in review but never actually verified.
  if (await isShopPreviewPrivateBySlug(shop.slug)) return { title: 'Página no encontrada' }
  return { title: `Colección — ${shop.name}` }
}

// Channel path (subdomain / custom domain): /c/[collection]. Shop identity
// comes from the request header middleware.ts sets, never from the URL.
export default async function ChannelCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>
}) {
  const { collection } = await params
  const shop = await resolveChannelShop()
  if (!shop) notFound()
  // Consent-safe previews: this is the CHANNEL-native page (subdomain / custom
  // domain serve it directly; middleware rewrites only `/` and `/convocatoria`),
  // so it needs the guard independently of the /s/[slug] variant.
  await assertShopNotPreviewPrivate(shop.slug)

  return (
    <CollectionPage
      shop={shop}
      collectionShortSlug={collection}
      basePath=""
      isMarketplaceRoute={false}
    />
  )
}
