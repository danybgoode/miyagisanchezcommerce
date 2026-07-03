/**
 * lib/promoter-coupon-server.ts
 *
 * Stripe side of the promoter seller-discount (epic 08 · promoter-program, S2).
 * Turns the admin-set promoter discount into a REAL billed Stripe discount at the
 * one-time custom-domain checkout — answering the S1 cross-review's "the discount
 * must actually move money, not just preview" note.
 *
 * ONE coupon backs the current discount, keyed by (type, amount) via the pure
 * `promoterCouponKey` (lib/promoter.ts): a fixed-pesos coupon (`amount_off`) or a
 * percentage coupon (`percent_off`), `duration:'once'`. Keying by amount keeps the
 * coupon immutable yet idempotent — changing the admin amount yields a new id, so
 * find-or-create never mutates a live coupon and never double-creates.
 *
 * Mirrors lib/domain-coupon-server.ts (the campaign coupon). server-only (holds
 * STRIPE_SECRET_KEY via `@/lib/stripe`).
 */
import 'server-only'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { CUSTOM_DOMAIN_CURRENCY } from '@/lib/domain-pricing'
import { promoterCouponKey, type PromoterSettings } from '@/lib/promoter'
import type { PromoterSku } from '@/lib/promoter-skus'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/** Duck-typed "this Stripe resource doesn't exist" — a coupon not minted yet. */
function isMissing(e: unknown): boolean {
  const err = (e ?? {}) as Record<string, unknown>
  return err.statusCode === 404 || err.code === 'resource_missing'
}

function couponIdOf(pc: Stripe.PromotionCode): string | null {
  const c = pc.promotion?.coupon
  if (!c) return null
  return typeof c === 'string' ? c : c.id
}

async function findCoupon(couponId: string): Promise<Stripe.Coupon | null> {
  try {
    const coupon = await stripe.coupons.retrieve(couponId)
    return coupon.deleted ? null : coupon
  } catch (e) {
    if (isMissing(e)) return null
    throw e
  }
}

async function findPromotionCode(code: string, couponId: string): Promise<Stripe.PromotionCode | null> {
  const list = await stripe.promotionCodes.list({ code, limit: 5 })
  return list.data.find((pc) => couponIdOf(pc) === couponId) ?? null
}

/**
 * Idempotent find-or-create of the promoter-discount Coupon + Promotion Code for
 * the current settings. Returns the promotion-code id to drop into the checkout's
 * `discounts`, or `null` when the discount can't back a coupon (disabled /
 * non-positive / percent out of 1–100). Safe to call on every checkout.
 */
export async function ensurePromoterDiscountPromotionCode(
  settings: PromoterSettings,
): Promise<string | null> {
  const key = promoterCouponKey(settings)
  if (!key) return null

  let coupon = await findCoupon(key.couponId)
  if (!coupon) {
    const base = {
      id: key.couponId,
      duration: 'once' as const,
      name: key.name, // ≤ 40 chars (enforced in promoterCouponKey)
      metadata: { kind: 'promoter_discount' },
    }
    coupon = await stripe.coupons.create(
      settings.discount_type === 'percentage'
        ? { ...base, percent_off: Math.round(settings.discount_amount_cents) }
        : {
            ...base,
            amount_off: Math.round(settings.discount_amount_cents),
            currency: CUSTOM_DOMAIN_CURRENCY.toLowerCase(),
          },
    )
  }

  let promo = await findPromotionCode(key.promoCode, coupon.id)
  if (!promo) {
    promo = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: key.promoCode,
      metadata: { kind: 'promoter_discount' },
    })
  }
  return promo.id
}

/**
 * Idempotent find-or-create of a FIXED-amount coupon keyed purely by (sku, cents)
 * — Sprint 3 (US-3.1). Used ONLY when a per-SKU promoter price override makes the
 * resolved discount diverge from the settings-based coupon above (`ensurePromoterDiscountPromotionCode`),
 * so the checkout charge always matches exactly what the landing/handbook/close
 * workspace advertise (the "no drift" acceptance bar). `duration:'once'` — same
 * shape as the settings-keyed coupon, just keyed by the resolved amount instead
 * of the global config. Returns `null` for a non-positive amount (nothing to
 * discount — the caller should skip passing a promotion code, not error).
 */
export async function ensureSkuDiscountPromotionCode(sku: PromoterSku, discountCents: number): Promise<string | null> {
  if (discountCents <= 0) return null
  const couponId = `promoter_sku_disc_${sku}_${Math.round(discountCents)}`
  const promoCode = `PROMOTER${sku.toUpperCase().replace(/_/g, '')}${Math.round(discountCents)}`
  const name = `Promotor ${sku} −$${Math.round(discountCents / 100)} MXN`.slice(0, 40)

  let coupon = await findCoupon(couponId)
  if (!coupon) {
    coupon = await stripe.coupons.create({
      id: couponId,
      duration: 'once',
      name,
      amount_off: Math.round(discountCents),
      currency: CUSTOM_DOMAIN_CURRENCY.toLowerCase(),
      metadata: { kind: 'promoter_sku_discount', sku },
    })
  }

  let promo = await findPromotionCode(promoCode, coupon.id)
  if (!promo) {
    promo = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: promoCode,
      metadata: { kind: 'promoter_sku_discount', sku },
    })
  }
  return promo.id
}

/**
 * Idempotent find-or-create of the promoter discount as a MEDUSA platform coupon
 * (the print-ad SKU bills through the Medusa cart, not a platform-side Stripe
 * charge — so its discount is a platform coupon, mirroring `mintPlatformCoupon`
 * in lib/referrals.ts). Returns the coupon CODE to pass into the print-ad
 * `startCheckout`, or `null` when the discount can't back a coupon. Reusable
 * (`usage_limit: null`) and deterministic by amount; a 409 means it already
 * exists → still the code. No backend change (the route is already deployed).
 */
export async function ensurePromoterPlatformCouponCode(
  settings: PromoterSettings,
): Promise<string | null> {
  const key = promoterCouponKey(settings)
  if (!key || !INTERNAL_SECRET) return null
  // `value` is in MAJOR units: pesos for `fixed`, the raw percent for `percentage`.
  const value =
    settings.discount_type === 'percentage'
      ? Math.round(settings.discount_amount_cents)
      : Math.round(settings.discount_amount_cents) / 100
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/platform-coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        code: key.promoCode,
        type: settings.discount_type,
        value,
        usage_limit: null, // reusable — every promoter shares the one current discount
        created_by: 'promoter',
      }),
    })
    // 201 created, 409 already exists → either way the code is usable.
    return res.ok || res.status === 409 ? key.promoCode : null
  } catch (e) {
    console.error('[promoter] platform coupon ensure failed:', e)
    return null
  }
}
