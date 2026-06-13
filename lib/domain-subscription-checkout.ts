/**
 * lib/domain-subscription-checkout.ts
 *
 * Shared builder for the custom-domain subscription Stripe checkout (epic 07 ·
 * custom-domain-paywall). One place owns: the plan-price lookup, the
 * already-active short-circuit, the campaign-coupon resolution + refusal, and
 * the `createSubscriptionCheckout` call — so the seller-portal buy route
 * (`/api/sell/shop/domain/subscribe`) and the seller-agent MCP tool
 * (`start_domain_subscription`) can't drift.
 *
 * server-only (reaches the Medusa subscriptions module + Stripe).
 */
import 'server-only'
import { createSubscriptionCheckout } from '@/lib/stripe-subscriptions'
import {
  getCustomDomainSubscription,
  CUSTOM_DOMAIN_CHECKOUT_KIND,
} from '@/lib/domain-subscription'
import { resolveCampaignPromotionCode } from '@/lib/domain-coupon-server'
import { CAMPAIGN_COUPON_CODE, couponRefusalMessage } from '@/lib/domain-coupon'

/** A fixed canonical origin — never trust a (spoofable) request Host for the
 *  post-payment redirect. Falls back to the production URL when unset. */
export function canonicalOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
}

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number; alreadyActive?: boolean }

/**
 * Build a Stripe checkout URL for the custom-domain subscription for one shop.
 * Optionally applies the campaign coupon (`miyagisan`) — 100% off the first
 * year, capped at 100 redemptions; an exhausted/invalid coupon is refused with
 * a clear es-MX message and no checkout is created.
 */
export async function startCustomDomainCheckout(input: {
  shopId: string
  sellerClerkId: string
  buyerEmail?: string
  channel: string
  /** Raw coupon code the seller/agent typed (optional). */
  couponCode?: string | null
}): Promise<StartCheckoutResult> {
  const { shopId, sellerClerkId, buyerEmail, channel } = input

  // Resolve the platform plan (price id) + short-circuit if already subscribed.
  const sub = await getCustomDomainSubscription(sellerClerkId)
  if (sub.active) {
    return {
      ok: false,
      status: 409,
      alreadyActive: true,
      error: 'Ya tienes una suscripción activa al dominio propio.',
    }
  }
  if (!sub.stripe_price_id) {
    return {
      ok: false,
      status: 422,
      error: 'El plan de dominio propio aún no está disponible. Intenta más tarde.',
    }
  }

  // Optional campaign coupon — refuse cleanly when exhausted/invalid.
  let promotionCodeId: string | undefined
  const rawCoupon = (input.couponCode ?? '').trim()
  if (rawCoupon) {
    const resolved = await resolveCampaignPromotionCode(rawCoupon)
    if (!resolved.ok) {
      return { ok: false, status: 422, error: couponRefusalMessage(resolved.reason) }
    }
    promotionCodeId = resolved.promotionCodeId
  }

  const origin = canonicalOrigin()

  const url = await createSubscriptionCheckout({
    priceId: sub.stripe_price_id,
    successUrl: `${origin}/shop/manage/settings/canal?domain=activated`,
    cancelUrl: `${origin}/shop/manage/settings/canal?domain=cancelled`,
    buyerEmail,
    metadata: {
      kind: CUSTOM_DOMAIN_CHECKOUT_KIND,
      shop_id: shopId,
      seller_clerk_id: sellerClerkId,
      channel,
      ...(promotionCodeId ? { coupon: CAMPAIGN_COUPON_CODE } : {}),
    },
    ...(promotionCodeId
      ? { promotionCodeId, paymentMethodCollection: 'if_required' as const }
      : {}),
  })

  return { ok: true, url }
}
