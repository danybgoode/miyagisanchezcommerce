import 'server-only'
import { getSellerEmailResult, sendShopCreatedWelcome } from '@/lib/email'
import { planShopCreatedWelcome } from '@/lib/shop-created-welcome-plan'
import { isMarketCode } from '@/lib/markets'
import { db } from '@/lib/supabase'
import type { MedusaSellerForMirror } from '@/lib/provisioning'

type Delivery = {
  seller_id: string
  owner_clerk_id: string
  shop_name: string
  shop_slug: string
  market: 'mx' | 'us'
  state: 'pending' | 'sending' | 'sent'
}

async function sendPending(delivery: Delivery): Promise<void> {
  if (delivery.state === 'sent') return
  const recipient = await getSellerEmailResult(delivery.owner_clerk_id)
  const plan = planShopCreatedWelcome({
    id: delivery.seller_id,
    name: delivery.shop_name,
    slug: delivery.shop_slug,
    metadata: { operating_market: delivery.market },
  }, recipient.email)
  if (!plan.ok) {
    console.error('[shop-created-welcome] delivery unavailable:', delivery.seller_id, plan.reason, recipient.reason)
    return
  }

  const { data: claimToken, error: reserveError } = await db.rpc('reserve_shop_created_welcome', {
    p_seller_id: delivery.seller_id,
    p_email: recipient.email,
  })
  if (reserveError) throw reserveError
  if (!claimToken) return

  const result = await sendShopCreatedWelcome(plan.context)
  if (!result.ok) {
    const { error } = await db.from('shop_created_welcome_deliveries')
      .update({ state: 'pending', claimed_at: null, claim_token: null })
      .eq('seller_id', delivery.seller_id).eq('state', 'sending').eq('claim_token', claimToken)
    if (error) console.error('[shop-created-welcome] release failed:', delivery.seller_id, error)
    console.error('[shop-created-welcome] delivery failed:', delivery.seller_id, result.reason, result.detail)
    return
  }
  const { error } = await db.from('shop_created_welcome_deliveries')
    .update({ state: 'sent', sent_at: new Date().toISOString(), provider_email_id: result.id, claim_token: null })
    .eq('seller_id', delivery.seller_id).eq('state', 'sending').eq('claim_token', claimToken)
  if (error) console.error('[shop-created-welcome] receipt update failed:', delivery.seller_id, error)
}

/** Create a durable delivery only for a genuinely new shop. */
export async function notifyShopCreated(ownerClerkId: string, seller: MedusaSellerForMirror): Promise<void> {
  const market = seller.metadata?.operating_market
  if (!isMarketCode(market)) {
    console.error('[shop-created-welcome] market unavailable:', seller.id, market)
    return
  }
  const delivery: Delivery = {
    seller_id: seller.id,
    owner_clerk_id: ownerClerkId,
    shop_name: seller.name,
    shop_slug: seller.slug,
    market,
    state: 'pending',
  }
  const { error } = await db.from('shop_created_welcome_deliveries')
    .upsert(delivery, { onConflict: 'seller_id', ignoreDuplicates: true })
  if (error) throw error
  await sendPending(delivery)
}

/** An existing-shop request retries only if creation previously registered a row. */
export async function retryShopCreatedWelcome(seller: Pick<MedusaSellerForMirror, 'id'>): Promise<void> {
  const { data, error } = await db.from('shop_created_welcome_deliveries')
    .select('seller_id, owner_clerk_id, shop_name, shop_slug, market, state')
    .eq('seller_id', seller.id).maybeSingle()
  if (error) throw error
  if (data) await sendPending(data as Delivery)
}
