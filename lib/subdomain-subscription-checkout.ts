/**
 * lib/subdomain-subscription-checkout.ts
 *
 * Shared builder for the subdomain subscription Stripe checkout (epic 07 ·
 * subdomain-pricing, Sprint 2). A faithful clone of
 * `lib/domain-subscription-checkout.ts` onto the cheaper subdomain SKU. One place
 * owns: the plan-price lookup, the already-active short-circuit, the promoter
 * one-time discount, and the `createSubscriptionCheckout` / `createOneTimeCheckout`
 * call — so the seller-portal buy route (`/api/sell/shop/subdomain/subscribe`) and
 * the seller-agent MCP tool (`start_subdomain_subscription`) can't drift.
 *
 * Unlike the custom-domain checkout there is NO campaign coupon (`miyagisan` is the
 * custom-domain SKU's promo); the subdomain recurring path is the plain plan price.
 * The promoter one-time discount applies exactly as it does for the custom domain.
 *
 * server-only (reaches the Medusa subscriptions module + Stripe).
 */
import 'server-only'
import { createSubscriptionCheckout, createOneTimeCheckout } from '@/lib/stripe-subscriptions'
import {
  getSubdomainSubscription,
  SUBDOMAIN_CHECKOUT_KIND,
} from '@/lib/subdomain-subscription'
import {
  SUBDOMAIN_PRICE_YEARLY_CENTS,
  SUBDOMAIN_CURRENCY,
} from '@/lib/subdomain-pricing'
import {
  coerceDomainCadence,
  type DomainCadence,
} from '@/lib/domain-cadence'
import {
  coerceSubdomainInterval,
  subdomainPriceIdForInterval,
  type SubdomainInterval,
} from '@/lib/subdomain-billing'
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

/** A fixed canonical origin — never trust a (spoofable) request Host for the
 *  post-payment redirect. Falls back to the production URL when unset. */
export function canonicalOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
}

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number; alreadyActive?: boolean }

/**
 * Build a Stripe checkout URL for the subdomain SKU for one shop, in either cadence:
 *   - `recurring` (default) → Stripe subscription against the platform subdomain plan.
 *   - `one_time` → Stripe `mode:'payment'` (pay a year up front, NO recurring
 *     mandate; the webhook writes a dated 12-month grant). Optionally applies the
 *     promoter discount as a REAL Stripe coupon when a valid `promoterCode` is given
 *     (epic 08). The discount is computed SERVER-SIDE from the admin settings —
 *     never a client-sent amount.
 *
 * Both cadences short-circuit if the seller already holds an active recurring
 * subscription.
 */
export async function startSubdomainCheckout(input: {
  shopId: string
  sellerClerkId: string
  buyerEmail?: string
  channel: string
  /** Payment cadence; unknown/blank → `recurring` (back-compat). */
  cadence?: DomainCadence | string | null
  /** Recurring billing interval (Sprint 3); unknown/blank → `year` (back-compat).
   *  Monthly is recurring-only — ignored on the `one_time` cadence (always a year). */
  interval?: SubdomainInterval | string | null
  /** Promoter code (`PRM-…`) for the real one-time discount (one-time path). */
  promoterCode?: string | null
  /** The PAYER is a promoter checking out on the seller's behalf (cash collected
   *  in person), not the seller themselves. Stamps a provenance marker on the
   *  session so the webhook records paid-by-promoter + audits the grant. One-time
   *  cadence only. */
  paidByPromoter?: boolean
}): Promise<StartCheckoutResult> {
  const { shopId, sellerClerkId, buyerEmail, channel } = input
  const cadence = coerceDomainCadence(input.cadence)

  // The one-time cadence is part of the promoter program (epic 08) — gated behind
  // promoter.enabled. With the flag off, a one-time request (only reachable by a
  // crafted/agent call — the UI hides the selector) is refused cleanly rather than
  // silently charged as a recurring subscription.
  const promoterEnabled = await isEnabled('promoter.enabled')
  if (cadence === 'one_time' && !promoterEnabled) {
    return { ok: false, status: 422, error: 'El pago de un año por adelantado aún no está disponible.' }
  }

  // An active recurring subscription already entitles — block either cadence.
  const sub = await getSubdomainSubscription(sellerClerkId)
  if (sub.active) {
    return {
      ok: false,
      status: 409,
      alreadyActive: true,
      error: 'Ya tienes una suscripción activa al subdominio.',
    }
  }

  const origin = canonicalOrigin()
  const successUrl = `${origin}/shop/manage/canal-propio?subdomain=activated`
  const cancelUrl = `${origin}/shop/manage/canal-propio?subdomain=cancelled`

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
        promoter, settings, itemsCents: SUBDOMAIN_PRICE_YEARLY_CENTS,
        sku: 'subdomain', skuPrices,
      })
      if (!resolved.ok) {
        return { ok: false, status: 422, error: promoterRefusalMessage(resolved.reason) }
      }
      promoterId = resolved.promoter_id
      // A per-SKU override (Sprint 3 · US-3.1 — e.g. the free first year, US-3.2)
      // needs its OWN coupon keyed by the exact resolved cents.
      promotionCodeId = (skuPrices.subdomain != null
        ? await ensureSkuDiscountPromotionCode('subdomain', resolved.discount_cents)
        : await ensurePromoterDiscountPromotionCode(settings)) ?? undefined
    }

    const url = await createOneTimeCheckout({
      amountCents: SUBDOMAIN_PRICE_YEARLY_CENTS,
      currency: SUBDOMAIN_CURRENCY,
      productName: 'Subdominio propio — 1 año (pago único)',
      successUrl,
      cancelUrl,
      buyerEmail,
      metadata: {
        kind: SUBDOMAIN_CHECKOUT_KIND,
        cadence: 'one_time',
        shop_id: shopId,
        seller_clerk_id: sellerClerkId,
        channel,
        ...(promoterId ? { promoter_id: promoterId, promoter_sku: 'subdomain' } : {}),
        ...(input.paidByPromoter ? { paid_by_promoter: PAID_BY_PROMOTER_FLAG } : {}),
      },
      ...(promotionCodeId ? { promotionCodeId } : {}),
    })
    return { ok: true, url }
  }

  // ── Recurring cadence (today's path) ──────────────────────────────────────
  // Pick the plan's price for the requested interval: yearly ($199/yr, the plan's
  // stripe_price_id column) or monthly ($25/mo, held on the plan metadata — Sprint 3).
  // A missing price (e.g. monthly not yet seeded) degrades to the same graceful
  // "aún no está disponible" as before.
  const interval = coerceSubdomainInterval(input.interval)
  const priceId = subdomainPriceIdForInterval(interval, {
    yearly: sub.stripe_price_id,
    monthly: sub.monthly_stripe_price_id,
  })
  if (!priceId) {
    return {
      ok: false,
      status: 422,
      error: 'El plan de subdominio aún no está disponible. Intenta más tarde.',
    }
  }

  const url = await createSubscriptionCheckout({
    priceId,
    successUrl,
    cancelUrl,
    buyerEmail,
    metadata: {
      kind: SUBDOMAIN_CHECKOUT_KIND,
      cadence: 'recurring',
      interval,
      shop_id: shopId,
      seller_clerk_id: sellerClerkId,
      channel,
    },
  })

  return { ok: true, url }
}
