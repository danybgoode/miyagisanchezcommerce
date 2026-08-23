import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  ListingPage,
  generateListingMetadata,
  type ListingRequestContext,
} from '@/app/(shell)/l/[id]/ListingRenderer'
import { isPublicReadChannel, type PublicReadChannel } from '@/lib/public-read'

// D19: Next requires a literal. Story 2.3 proves this equals CACHE.LISTING.
export const revalidate = 60

// No live catalog is snapshotted at build time; the first eligible request seeds ISR.
export function generateStaticParams() {
  return []
}

type Props = {
  params: Promise<{
    channel: string
    identity: string
    slug: string
    id: string
  }>
}

function requestContext(
  channel: PublicReadChannel,
  identity: string,
  slug: string,
): ListingRequestContext {
  return {
    mode: 'public',
    channelSlug: channel === 'subdomain' ? slug : null,
    customDomain: channel === 'subdomain' ? identity : null,
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channel, identity, slug, id } = await params
  if (!isPublicReadChannel(channel) || channel === 'embed') return { title: 'Anuncio no encontrado' }
  return generateListingMetadata({
    params: Promise.resolve({ id }),
    market: 'mx',
    marketBasePath: channel === 'marketplace' ? '/mx' : '',
    requestContext: requestContext(channel, identity, slug),
  })
}

export default async function PublicListingPage({ params }: Props) {
  const { channel, identity, slug, id } = await params
  if (!isPublicReadChannel(channel) || channel === 'embed') notFound()
  return ListingPage({
    params: Promise.resolve({ id }),
    market: 'mx',
    marketBasePath: channel === 'marketplace' ? '/mx' : '',
    requestContext: requestContext(channel, identity, slug),
  })
}
