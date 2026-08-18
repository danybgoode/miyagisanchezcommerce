import { notFound } from 'next/navigation'
import { resolveShopPresentation } from '@/lib/shop-presentation/context'
import { navSections } from '@/lib/shop-presentation/sections'
import ShopIndexBody from '@/app/(shell)/_shop-sections/ShopIndexBody'
import type { Metadata } from 'next'

/**
 * Living Shop — the "tienda" section on the MARKETPLACE host (epic 07, Sprint 3).
 *
 * Same body, same context resolver, different base path — which is the entire
 * difference between the two channels and the reason it is resolved in one place
 * rather than branched per route.
 */

export const revalidate = 120

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const ctx = await resolveShopPresentation(slug)
  if (!ctx) return { title: 'Página no encontrada' }
  return { title: `${ctx.shop.name}` }
}

export default async function MarketplaceSectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await resolveShopPresentation(slug)
  if (!ctx) notFound()
  if (!navSections(ctx.sections, ctx.availability).includes('shop')) notFound()
  return <ShopIndexBody ctx={ctx} />
}
