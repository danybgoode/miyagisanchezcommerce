import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getShopListings } from '@/lib/listings'
import ComparteClient from './ComparteClient'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Comparte tu tienda' }

/**
 * S8 Comparte + agent loop-close (onboarding three-doors, Sprint 3 · Story
 * 3.2). Replaces the setup guide's `comparte` step placeholder CTA (which
 * pointed at the bare /shop/manage dashboard) with a real share moment.
 */
export default async function CompartePage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug, name, logo_url, location, metadata')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  const listings = await getShopListings(shop.slug)
  const meta = shop.metadata as Record<string, unknown> | null
  const agentTokenSet = !!meta?.ucp_agent_token_hash

  return (
    <ComparteClient
      shopName={shop.name}
      shopSlug={shop.slug}
      logoUrl={shop.logo_url}
      location={shop.location}
      productCount={listings.length}
      agentTokenSet={agentTokenSet}
    />
  )
}
