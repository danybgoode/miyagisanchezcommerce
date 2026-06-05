import 'server-only'

import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { ensureSupabaseShopMirror, type MedusaSellerForMirror } from '@/lib/provisioning'
import type { SweepstakesCampaign } from '@/lib/sweepstakes-types'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

function medusaFetch(path: string, clerkJwt: string) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    cache: 'no-store',
  })
}

export async function resolveSweepstakesSeller(): Promise<{
  userId: string
  seller: MedusaSellerForMirror
  shop: { id: string; slug: string; metadata: Record<string, unknown> | null }
} | null> {
  const user = await currentUser()
  if (!user) return null
  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) return null

  const sellerRes = await medusaFetch('/store/sellers/me', clerkJwt)
  if (!sellerRes.ok) return null
  const { seller } = await sellerRes.json() as { seller: MedusaSellerForMirror }
  const shop = await ensureSupabaseShopMirror(seller, user.id)
  if (!shop?.id) return null
  return { userId: user.id, seller, shop }
}

export async function getSellerSweepstakesCampaign(campaignId: string): Promise<{
  context: Awaited<ReturnType<typeof resolveSweepstakesSeller>>
  campaign: SweepstakesCampaign
} | null> {
  const context = await resolveSweepstakesSeller()
  if (!context) return null

  const { data, error } = await db
    .from('marketplace_sweepstakes_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('shop_id', context.shop.id)
    .maybeSingle()

  if (error || !data) return null
  return { context, campaign: data as SweepstakesCampaign }
}
