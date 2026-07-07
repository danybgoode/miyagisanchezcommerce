import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getShop } from '@/lib/listings'
import FaqBody from '../_shop-content/FaqBody'
import type { Metadata } from 'next'

export const revalidate = 120

async function resolveChannelShop() {
  const channelSlug = (await headers()).get('x-miyagi-shop-slug')
  // No channel header ⇒ we're on the platform host, where a bare `/faq` has
  // no meaning (the marketplace path is /s/[slug]/faq) — self-404 without a
  // Medusa fetch. The header is set ONLY by middleware.ts (never
  // client-controllable), so this is a hard boundary, not a spoofable one.
  if (!channelSlug) return null
  return getShop(channelSlug)
}

export async function generateMetadata(): Promise<Metadata> {
  const shop = await resolveChannelShop()
  if (!shop) return { title: 'Página no encontrada' }
  return { title: `Preguntas frecuentes — ${shop.name}` }
}

// Channel path (subdomain / custom domain): /faq. Shop identity comes from
// the request header middleware.ts sets, never from the URL.
export default async function ChannelFaqPage() {
  const shop = await resolveChannelShop()
  if (!shop) notFound()

  return <FaqBody shop={shop} basePath="" />
}
