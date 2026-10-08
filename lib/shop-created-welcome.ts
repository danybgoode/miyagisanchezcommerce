import 'server-only'
import { getSellerEmailResult, sendShopCreatedWelcome } from '@/lib/email'
import { planShopCreatedWelcome } from '@/lib/shop-created-welcome-plan'
import type { MedusaSellerForMirror } from '@/lib/provisioning'

/** Use the created seller's persisted market, never the browser locale or request. */
export async function notifyShopCreated(ownerClerkId: string, seller: MedusaSellerForMirror): Promise<void> {
  const recipient = await getSellerEmailResult(ownerClerkId)
  const plan = planShopCreatedWelcome(seller, recipient.email)
  if (!plan.ok) {
    console.error('[shop-created-welcome] delivery unavailable:', seller.id, plan.reason, recipient.reason)
    return
  }
  const result = await sendShopCreatedWelcome(plan.context)
  if (!result.ok) console.error('[shop-created-welcome] delivery failed:', seller.id, result.reason, result.detail)
}
