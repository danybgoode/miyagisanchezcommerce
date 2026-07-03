/**
 * lib/ml-sync-subscription-checkout.ts
 *
 * Shared builder for the ML-sync SKU Stripe checkout (epic 03 · mercadolibre-sync,
 * Sprint 6). A faithful clone of `lib/subdomain-subscription-checkout.ts`. One place
 * owns: the plan-price lookup, the already-active short-circuit, the promoter
 * one-time discount, and the `createSubscriptionCheckout` / `createOneTimeCheckout`
 * call — so the seller buy route (`/api/sell/ml/subscribe`) and the promoter close
 * route (`/api/promoter/close/ml-sync`) can't drift.
 *
 * server-only (reaches the Medusa subscriptions module + Stripe).
 */
import 'server-only'
import { createSubscriptionCheckout, createOneTimeCheckout } from '@/lib/stripe-subscriptions'
import { getMlSyncSubscription, ML_SYNC_CHECKOUT_KIND } from '@/lib/ml-sync-subscription'
import { ML_SYNC_PRICE_YEARLY_CENTS, ML_SYNC_CURRENCY } from '@/lib/ml-sync-pricing'
import { coerceDomainCadence, type DomainCadence } from '@/lib/domain-cadence'
import { coerceMlSyncInterval, mlSyncPriceIdForInterval, type MlSyncInterval } from '@/lib/ml-sync-billing'
import { PAID_BY_PROMOTER_FLAG } from '@/lib/promoter-close'
import { isEnabled } from '@/lib/flags'
import {
  getPromoterByCode,
  getPromoterSettings,
  getPromoterSkuPrices,
  resolvePromoterDiscount,
  promoterRefusalMessage,
} from '@/lib/promoter'
import { ensurePromoterDiscountPromotionCode, ensureSkuDiscountPromotionCode } from '@/lib/promoter-coupon-server'

/** A fixed canonical origin — never trust a (spoofable) request Host. */
export function canonicalOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
}

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number; alreadyActive?: boolean }

/**
 * Build a Stripe checkout URL for the ML-sync SKU for one shop, in either cadence:
 *   - `recurring` (default) → Stripe subscription against the platform ML-sync plan
 *     (yearly $299/yr or monthly $30/mo, per `interval`).
 *   - `one_time` → Stripe `mode:'payment'` (pay a year up front, NO recurring
 *     mandate; the webhook writes a dated 12-month `ml_sync_grant`). Optionally
 *     applies the promoter discount as a REAL Stripe coupon (computed SERVER-SIDE).
 *
 * Both cadences short-circuit if the seller already holds an active subscription.
 */
export async function startMlSyncCheckout(input: {
  shopId: string
  sellerClerkId: string
  buyerEmail?: string
  channel: string
  /** Payment cadence; unknown/blank → `recurring` (back-compat). */
  cadence?: DomainCadence | string | null
  /** Recurring interval; unknown/blank → `year`. Monthly is recurring-only. */
  interval?: MlSyncInterval | string | null
  /** Promoter code (`PRM-…`) for the real one-time discount (one-time path). */
  promoterCode?: string | null
  /** The PAYER is a promoter checking out on the seller's behalf. One-time only. */
  paidByPromoter?: boolean
}): Promise<StartCheckoutResult> {
  const { shopId, sellerClerkId, buyerEmail, channel } = input
  const cadence = coerceDomainCadence(input.cadence)

  // The one-time cadence is part of the promoter program — gated behind
  // promoter.enabled. With the flag off, a one-time request (only reachable by a
  // crafted/agent call) is refused cleanly rather than silently charged as recurring.
  const promoterEnabled = await isEnabled('promoter.enabled')
  if (cadence === 'one_time' && !promoterEnabled) {
    return { ok: false, status: 422, error: 'El pago de un año por adelantado aún no está disponible.' }
  }

  // An active subscription already entitles — block either cadence.
  const sub = await getMlSyncSubscription(sellerClerkId)
  if (sub.active) {
    return {
      ok: false,
      status: 409,
      alreadyActive: true,
      error: 'Ya tienes la sincronización de Mercado Libre activa.',
    }
  }

  const origin = canonicalOrigin()
  const successUrl = `${origin}/shop/manage/mercadolibre?ml_sync=activated`
  const cancelUrl = `${origin}/shop/manage/mercadolibre?ml_sync=cancelled`

  // ── One-time cadence: pay a year up front, no recurring mandate ───────────
  if (cadence === 'one_time') {
    // Resolve the promoter discount server-side (never trust a client amount).
    let promotionCodeId: string | undefined
    let promoterId: string | undefined
    const rawPromoter = (input.promoterCode ?? '').trim()
    if (rawPromoter && promoterEnabled) {
      const [promoter, settings, skuPrices] = await Promise.all([
        getPromoterByCode(rawPromoter),
        getPromoterSettings(),
        getPromoterSkuPrices(),
      ])
      const resolved = resolvePromoterDiscount({
        promoter, settings, itemsCents: ML_SYNC_PRICE_YEARLY_CENTS,
        sku: 'ml_sync', skuPrices,
      })
      if (!resolved.ok) {
        return { ok: false, status: 422, error: promoterRefusalMessage(resolved.reason) }
      }
      promoterId = resolved.promoter_id
      promotionCodeId = (skuPrices.ml_sync != null
        ? await ensureSkuDiscountPromotionCode('ml_sync', resolved.discount_cents)
        : await ensurePromoterDiscountPromotionCode(settings)) ?? undefined
    }

    const url = await createOneTimeCheckout({
      amountCents: ML_SYNC_PRICE_YEARLY_CENTS,
      currency: ML_SYNC_CURRENCY,
      productName: 'Sincronización Mercado Libre — 1 año (pago único)',
      successUrl,
      cancelUrl,
      buyerEmail,
      metadata: {
        kind: ML_SYNC_CHECKOUT_KIND,
        cadence: 'one_time',
        shop_id: shopId,
        seller_clerk_id: sellerClerkId,
        channel,
        ...(promoterId ? { promoter_id: promoterId, promoter_sku: ML_SYNC_CHECKOUT_KIND } : {}),
        ...(input.paidByPromoter ? { paid_by_promoter: PAID_BY_PROMOTER_FLAG } : {}),
      },
      ...(promotionCodeId ? { promotionCodeId } : {}),
    })
    return { ok: true, url }
  }

  // ── Recurring cadence (yearly or monthly) ─────────────────────────────────
  const interval = coerceMlSyncInterval(input.interval)
  const priceId = mlSyncPriceIdForInterval(interval, {
    yearly: sub.stripe_price_id,
    monthly: sub.monthly_stripe_price_id,
  })
  if (!priceId) {
    return {
      ok: false,
      status: 422,
      error: 'El plan de sincronización aún no está disponible. Intenta más tarde.',
    }
  }

  const url = await createSubscriptionCheckout({
    priceId,
    successUrl,
    cancelUrl,
    buyerEmail,
    metadata: {
      kind: ML_SYNC_CHECKOUT_KIND,
      cadence: 'recurring',
      interval,
      shop_id: shopId,
      seller_clerk_id: sellerClerkId,
      channel,
    },
  })

  return { ok: true, url }
}
