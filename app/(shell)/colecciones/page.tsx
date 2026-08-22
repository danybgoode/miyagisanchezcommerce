import { notFound } from 'next/navigation'
import { resolveRequestShopPresentation as resolveShopPresentation } from '@/lib/shop-presentation/request-context'
import { navSections } from '@/lib/shop-presentation/sections'
import CollectionsIndexBody from '../_shop-sections/CollectionsIndexBody'
import type { Metadata } from 'next'

/**
 * Living Shop — the "colecciones" section on an OWNED host (epic 07, Sprint 3).
 *
 * Subdomain and custom domain serve this path natively: middleware rewrites only
 * `/` and `/convocatoria` and passes everything else through with the channel
 * headers (epic D6 — verified in `middleware.ts`, which this epic does not
 * touch). The shop comes from the unspoofable `x-miyagi-shop-slug` header,
 * never from the URL, exactly as `/acerca` and `/c/[collection]` already do it.
 *
 * On the PLATFORM host there is no such header, so this bare path has no meaning
 * and 404s without a Medusa call — the marketplace form is `/s/[slug]/colecciones`.
 */

export const revalidate = 120

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await resolveShopPresentation(null)
  if (!ctx) return { title: 'Página no encontrada' }
  return { title: `${ctx.shop.name}` }
}

export default async function ChannelSectionPage() {
  const ctx = await resolveShopPresentation(null)
  if (!ctx) notFound()
  // A section the shop does not have is a 404, not an empty page: the nav never
  // links here in that case, so a request that arrives anyway is a stale link or
  // a guess, and answering 200 would put an empty destination in a sitemap.
  if (!navSections(ctx.sections, ctx.availability).includes('collections')) notFound()
  return <CollectionsIndexBody ctx={ctx} />
}
