import { currentUser } from '@clerk/nextjs/server'
import { headers } from 'next/headers'
import { getActiveDealForBuyer } from '@/lib/active-deal'
import { db } from '@/lib/supabase'
import {
  ListingPage as renderListingPage,
  generateListingMetadata as renderListingMetadata,
  type ListingRequestContext,
} from './ListingRenderer'

type MetadataArgs = Parameters<typeof renderListingMetadata>[0]
type PageArgs = Parameters<typeof renderListingPage>[0]

async function requestChannel(): Promise<Pick<ListingRequestContext, 'channelSlug' | 'customDomain'>> {
  const requestHeaders = await headers()
  return {
    channelSlug: requestHeaders.get('x-miyagi-shop-slug'),
    customDomain: requestHeaders.get('x-miyagi-domain'),
  }
}

export async function generateListingMetadata(args: MetadataArgs) {
  return renderListingMetadata({
    ...args,
    requestContext: { mode: 'dynamic', ...(await requestChannel()) },
  })
}

export const generateMetadata = generateListingMetadata

export async function ListingPage(args: PageArgs) {
  const [{ id }, channel, user] = await Promise.all([
    args.params,
    requestChannel(),
    currentUser(),
  ])
  const [favorite, activeDeal] = user
    ? await Promise.all([
        db
          .from('marketplace_favorites')
          .select('id, marketplace_listings!inner(medusa_product_id)')
          .eq('clerk_user_id', user.id)
          .eq('marketplace_listings.medusa_product_id', id)
          .maybeSingle(),
        getActiveDealForBuyer(id, user.id),
      ])
    : [{ data: null }, null]

  return renderListingPage({
    ...args,
    requestContext: {
      mode: 'dynamic',
      ...channel,
      userId: user?.id ?? null,
      favorited: !!favorite.data,
      activeDeal,
      buyerPrefill: user ? {
        name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        email: user.emailAddresses[0]?.emailAddress ?? '',
      } : null,
    },
  })
}

export default ListingPage
