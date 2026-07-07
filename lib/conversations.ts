/**
 * Shared find-or-create for the buyer-seller conversation keyed by
 * (buyer_clerk_user_id, listing_id) — extracted from
 * `app/api/conversations/start/route.ts` so a second caller (the proof-send
 * flow, custom-print-products S4 · 4.1) can open/reuse the same conversation
 * for an order that never went through negotiation.
 */
import 'server-only'
import { db } from '@/lib/supabase'

export interface FindOrCreateConversationParams {
  listingId: string
  shopId: string
  buyerClerkUserId: string
  sellerClerkUserId: string
  /** Stamped when the conversation is being opened FROM a known real order
   *  (a buy-now purchase has no offer, so this is the only durable link the
   *  transaction ledger can resolve state through). Never overwrites an
   *  existing value on conflict — a conversation should stay linked to
   *  whichever order first opened it. */
  medusaOrderId?: string
}

/** Returns the conversation id, or null if the upsert failed. */
export async function findOrCreateConversation(
  params: FindOrCreateConversationParams,
): Promise<string | null> {
  const { listingId, shopId, buyerClerkUserId, sellerClerkUserId, medusaOrderId } = params
  const now = new Date().toISOString()

  const { data: conv, error } = await db
    .from('marketplace_conversations')
    .upsert({
      listing_id: listingId,
      shop_id: shopId,
      buyer_clerk_user_id: buyerClerkUserId,
      seller_clerk_user_id: sellerClerkUserId,
      last_event_at: now,
      updated_at: now,
    }, { onConflict: 'buyer_clerk_user_id,listing_id', ignoreDuplicates: false })
    .select('id, medusa_order_id')
    .single()

  if (error || !conv) {
    console.error('[conversations] find-or-create failed:', error)
    return null
  }

  // Only stamp medusa_order_id the FIRST time — never clobber an existing
  // link (e.g. a second order for the same buyer/listing pair reuses the
  // same conversation thread; the ledger stays pinned to whichever order
  // opened it first).
  if (medusaOrderId && !conv.medusa_order_id) {
    await db
      .from('marketplace_conversations')
      .update({ medusa_order_id: medusaOrderId })
      .eq('id', conv.id)
  }

  return conv.id
}
