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
import { createSubscriptionCheckout, createOneTimeCheckout } from '@/lib/stripe-subscriptions'
import {
  getCustomDomainSubscription,
  CUSTOM_DOMAIN_CHECKOUT_KIND,
} from '@/lib/domain-subscription'
import { resolveCampaignPromotionCode } from '@/lib/domain-coupon-server'
import { CAMPAIGN_COUPON_CODE, couponRefusalMessage } from '@/lib/domain-coupon'
import {
  CUSTOM_DOMAIN_PRICE_CENTS,
  CUSTOM_DOMAIN_CURRENCY,
} from '@/lib/domain-pricing'
import {
  coerceDomainCadence,
  type DomainCadence,
} from '@/lib/domain-cadence'
import { isEnabled } from '@/lib/flags'
import {
  getPromoterByCode,
  getPromoterSettings,
  resolvePromoterDiscount,
  promoterRefusalMessage,
} from '@/lib/promoter'
import { ensurePromoterDiscountPromotionCode } from '@/lib/promoter-coupon-server'

/** A fixed canonical origin — never trust a (spoofable) request Host for the
 *  post-payment redirect. Falls back to the production URL when unset. */
export function canonicalOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
}

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number; alreadyActive?: boolean }

/**
 * Build a Stripe checkout URL for the custom-domain SKU for one shop, in either
 * cadence:
 *   - `recurring` (default) → Stripe subscription. Optionally applies the campaign
 *     coupon (`miyagisan`) — 100% off the first year, capped; refused cleanly when
 *     exhausted/invalid.
 *   - `one_time` → Stripe `mode:'payment'` (pay a year up front, NO recurring
 *     mandate; the webhook writes a dated 12-month grant). Optionally applies the
 *     promoter discount as a REAL Stripe coupon when a valid `promoterCode` is
 *     given (epic 08 · S2). The discount is computed SERVER-SIDE from the admin
 *     settings — never a client-sent amount.
 *
 * Both cadences short-circuit if the seller already holds an active recurring
 * subscription.
 */
export async function startCustomDomainCheckout(input: {
  shopId: string
  sellerClerkId: string
  buyerEmail?: string
  channel: string
  /** Raw campaign-coupon code the seller/agent typed (recurring path only). */
  couponCode?: string | null
  /** Payment cadence; unknown/blank → `recurring` (back-compat). */
  cadence?: DomainCadence | string | null
  /** Promoter code (`PRM-…`) for the real one-time discount (one-time path). */
  promoterCode?: string | null
}): Promise<StartCheckoutResult> {
  const { shopId, sellerClerkId, buyerEmail, channel } = input
  const cadence = coerceDomainCadence(input.cadence)

  // The one-time cadence is part of the promoter program (epic 08 · S2) — gated
  // behind promoter.enabled so the whole sprint is dark until launch. With the
  // flag off, a one-time request (only reachable by a crafted/agent call — the UI
  // hides the selector) is refused cleanly rather than silently charged as a
  // recurring subscription. Resolve the flag once; reused for the discount below.
  const promoterEnabled = await isEnabled('promoter.enabled')
  if (cadence === 'one_time' && !promoterEnabled) {
    return { ok: false, status: 422, error: 'El pago de un año por adelantado aún no está disponible.' }
  }

  // An active recurring subscription already entitles — block either cadence.
  const sub = await getCustomDomainSubscription(sellerClerkId)
  if (sub.active) {
    return {
      ok: false,
      status: 409,
      alreadyActive: true,
      error: 'Ya tienes una suscripción activa al dominio propio.',
    }
  }

  const origin = canonicalOrigin()
  const successUrl = `${origin}/shop/manage/settings/canal?domain=activated`
  const cancelUrl = `${origin}/shop/manage/settings/canal?domain=cancelled`

  // ── One-time cadence: pay a year up front, no recurring mandate ───────────
  if (cadence === 'one_time') {
    // Resolve the promoter discount server-side (never trust a client amount).
    let promotionCodeId: string | undefined
    let promoterId: string | undefined
    const rawPromoter = (input.promoterCode ?? '').trim()
    if (rawPromoter && promoterEnabled) {
      const [promoter, settings] = await Promise.all([
        getPromoterByCode(rawPromoter),
        getPromoterSettings(),
      ])
      const resolved = resolvePromoterDiscount({ promoter, settings, itemsCents: CUSTOM_DOMAIN_PRICE_CENTS })
      if (!resolved.ok) {
        return { ok: false, status: 422, error: promoterRefusalMessage(resolved.reason) }
      }
      promoterId = resolved.promoter_id
      promotionCodeId = (await ensurePromoterDiscountPromotionCode(settings)) ?? undefined
    }

    const url = await createOneTimeCheckout({
      amountCents: CUSTOM_DOMAIN_PRICE_CENTS,
      currency: CUSTOM_DOMAIN_CURRENCY,
      productName: 'Dominio propio — 1 año (pago único)',
      successUrl,
      cancelUrl,
      buyerEmail,
      metadata: {
        kind: CUSTOM_DOMAIN_CHECKOUT_KIND,
        cadence: 'one_time',
        shop_id: shopId,
        seller_clerk_id: sellerClerkId,
        channel,
        ...(promoterId ? { promoter_id: promoterId, promoter_sku: 'custom_domain' } : {}),
      },
      ...(promotionCodeId ? { promotionCodeId } : {}),
    })
    return { ok: true, url }
  }

  // ── Recurring cadence (today's path) ──────────────────────────────────────
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

  const url = await createSubscriptionCheckout({
    priceId: sub.stripe_price_id,
    successUrl,
    cancelUrl,
    buyerEmail,
    metadata: {
      kind: CUSTOM_DOMAIN_CHECKOUT_KIND,
      cadence: 'recurring',
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
