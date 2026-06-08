import 'server-only'

import { db } from '@/lib/supabase'
import { resolveSweepstakesSeller } from '@/lib/sweepstakes-seller'
import type { MarketplaceEvent } from '@/lib/events-types'

export async function resolveEventSeller() {
  return resolveSweepstakesSeller()
}

export async function getSellerEvent(eventId: string): Promise<{
  context: Awaited<ReturnType<typeof resolveEventSeller>>
  event: MarketplaceEvent
} | null> {
  const context = await resolveEventSeller()
  if (!context) return null

  const { data, error } = await db
    .from('marketplace_events')
    .select('*')
    .eq('id', eventId)
    .eq('shop_id', context.shop.id)
    .maybeSingle()

  if (error || !data) return null
  return { context, event: data as MarketplaceEvent }
}
