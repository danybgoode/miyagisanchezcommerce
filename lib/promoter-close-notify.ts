/**
 * Promoter Funnel v2 · Sprint 5 (US-5.5) — the shared merchant close-receipt
 * notifier. One tiny server-only seam so all six real completion call sites
 * (3 Stripe webhook handlers, the free-subdomain grant, the print-ad paid-
 * emails function, the transfer-approval route) fire the same email the same
 * way, instead of re-deriving the shop/recipient/claim-link logic six times.
 *
 * Best-effort — never throws into the caller, matching every other
 * notification call in this codebase (tg.alert(), the *Paid* email senders).
 */
import 'server-only'
import { resolveTargetShop } from '@/lib/promoter-server'
import { getPromoterById } from '@/lib/promoter'
import { signClaimToken } from '@/lib/claimJwt'
import { buildClaimLandingUrl, normalizedClaimEmail } from '@/lib/claim-invitation'
import { sendMerchantCloseReceipt, getSellerEmail } from '@/lib/email'
import type { CloseReceiptItem } from '@/lib/promoter-close-receipt'


export async function notifyMerchantCloseReceipt(input: {
  /** marketplace_shops.id — the mirror UUID (survives claim). */
  shopId: string
  promoterId: string
  items: CloseReceiptItem[]
}): Promise<void> {
  try {
    const shop = await resolveTargetShop({ shopId: input.shopId })
    if (!shop || !shop.medusaSellerId) return

    const merchantEmail = normalizedClaimEmail(shop.metadata.merchant_email)

    // Fall back to the promoter's own email (adapted copy) when the promoter
    // didn't capture one at setup (Decision 3, sprint-5 plan).
    let to = merchantEmail
    if (!to) {
      const promoter = await getPromoterById(input.promoterId)
      to = promoter?.clerk_user_id ? await getSellerEmail(promoter.clerk_user_id) : null
    }
    if (!to) return // nowhere to send it — not an error, just no recipient yet

    const claimUrl = merchantEmail ? buildClaimLandingUrl(await signClaimToken({
      shopId: shop.medusaSellerId,
      shopSlug: shop.slug,
      shopName: shop.name,
      purpose: 'promoter',
    }, null)) : undefined

    await sendMerchantCloseReceipt({
      to,
      shopName: shop.name,
      items: input.items,
      claimUrl,
      toMerchantDirectly: !!merchantEmail,
    })
  } catch (e) {
    console.error('[promoter-close-notify] failed:', e)
  }
}
