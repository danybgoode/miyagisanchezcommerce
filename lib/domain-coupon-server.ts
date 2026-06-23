/**
 * lib/domain-coupon-server.ts
 *
 * Stripe side of the custom-domain campaign coupon `miyagisan` (epic 07 ·
 * custom-domain-paywall, Sprint 3). The coupon is a Stripe Coupon + Promotion
 * Code on the PLATFORM account:
 *   - Coupon: percent_off 100, duration `once` (annual interval ⇒ first year
 *     free, then the standard $499 MXN/yr renewal), max_redemptions 100. Stripe
 *     enforces the cap server-side — the 101st redemption is refused.
 *   - Promotion Code `MIYAGISAN`: the human-typeable layer referencing it.
 *
 * Both the coupon and the promo code use deterministic ids/codes so every call
 * is idempotent (find-or-create) — the admin "mint" button can be pressed any
 * number of times without creating duplicates. The pure rules (matching, the
 * redeemable boundary, the counter) live in `lib/domain-coupon.ts`.
 *
 * server-only (holds STRIPE_SECRET_KEY via `@/lib/stripe`).
 */
import 'server-only'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import {
  CAMPAIGN_COUPON_CAP,
  CAMPAIGN_COUPON_CODE,
  couponRedeemable,
  isCampaignCode,
  classifyStripeFailure,
  describeStripeFailure,
  isResourceMissing,
  type CouponRefusalReason,
  type StripeErrorShape,
  type StripeFailureKind,
} from '@/lib/domain-coupon'

/** Deterministic Stripe ids so find-or-create is idempotent. */
const COUPON_ID = 'custom_domain_campaign_miyagisan'
const PROMO_CODE = 'MIYAGISAN' // Stripe promotion code (case-insensitive on redemption)

export type CampaignCouponStatus = {
  exists: boolean
  code: string
  redeemed: number
  cap: number
  remaining: number
  active: boolean
  coupon_id: string | null
  promotion_code_id: string | null
}

const EMPTY: CampaignCouponStatus = {
  exists: false,
  code: CAMPAIGN_COUPON_CODE,
  redeemed: 0,
  cap: CAMPAIGN_COUPON_CAP,
  remaining: CAMPAIGN_COUPON_CAP,
  active: false,
  coupon_id: null,
  promotion_code_id: null,
}

function couponIdOf(pc: Stripe.PromotionCode): string | null {
  const c = pc.promotion?.coupon
  if (!c) return null
  return typeof c === 'string' ? c : c.id
}

/**
 * Pull the key-free, classifiable fields off a caught Stripe error (duck-typed —
 * no `instanceof`, robust to SDK internals). The secret key is never in any of
 * these fields. Feeds the pure classifier in `lib/domain-coupon.ts`.
 */
function stripeErrorShape(e: unknown): StripeErrorShape {
  const err = (e ?? {}) as Record<string, unknown>
  return {
    statusCode: typeof err.statusCode === 'number' ? err.statusCode : null,
    code: typeof err.code === 'string' ? err.code : null,
    type: typeof err.type === 'string' ? err.type : null,
    rawType: typeof err.rawType === 'string' ? err.rawType : null,
    message: typeof err.message === 'string' ? err.message : null,
  }
}

/**
 * Map a caught error to a sanitized, surfaceable shape for the admin route. The
 * message is OUR es-MX copy keyed by failure kind — Stripe's raw message (which
 * can echo a redacted key) is never passed through. `detail` carries only the
 * safe `type`/`code` for diagnosis (S1.3).
 */
export function describeCouponError(e: unknown): {
  kind: StripeFailureKind
  message: string
  detail: { type: string | null; code: string | null }
} {
  const shape = stripeErrorShape(e)
  const kind = classifyStripeFailure(shape)
  return {
    kind,
    message: describeStripeFailure(kind),
    detail: { type: shape.type ?? null, code: shape.code ?? null },
  }
}

async function findCoupon(): Promise<Stripe.Coupon | null> {
  try {
    return await stripe.coupons.retrieve(COUPON_ID)
  } catch (e) {
    // A genuine "resource missing" means the coupon simply hasn't been minted
    // yet → null/EMPTY. But an auth / permission / connection failure must NOT
    // pose as "not minted" — surface it so the admin tool can show the real cause.
    if (isResourceMissing(stripeErrorShape(e))) return null
    throw e
  }
}

async function findPromotionCode(couponId: string): Promise<Stripe.PromotionCode | null> {
  const list = await stripe.promotionCodes.list({ code: PROMO_CODE, limit: 5 })
  return list.data.find((pc) => couponIdOf(pc) === couponId) ?? null
}

function toStatus(
  coupon: Stripe.Coupon,
  promo: Stripe.PromotionCode | null,
): CampaignCouponStatus {
  const redeemed = coupon.times_redeemed ?? 0
  const cap = coupon.max_redemptions ?? CAMPAIGN_COUPON_CAP
  // Stripe flips `coupon.valid` false once max_redemptions is hit (or it expires);
  // `promo.active` is the promotion-code toggle. Both must hold to be live.
  const active = !!coupon.valid && (promo ? promo.active : false)
  return {
    exists: true,
    code: CAMPAIGN_COUPON_CODE,
    redeemed,
    cap,
    remaining: Math.max(0, cap - redeemed),
    active,
    coupon_id: coupon.id,
    promotion_code_id: promo?.id ?? null,
  }
}

/**
 * Idempotent find-or-create of the campaign Coupon + Promotion Code. Safe to
 * call repeatedly (admin mint button). Returns the live status afterwards.
 */
export async function ensureCampaignCoupon(): Promise<CampaignCouponStatus> {
  let coupon = await findCoupon()
  if (!coupon) {
    coupon = await stripe.coupons.create({
      id: COUPON_ID,
      percent_off: 100,
      duration: 'once',
      max_redemptions: CAMPAIGN_COUPON_CAP,
      name: 'Dominio propio — primer año gratis (miyagisan)',
      metadata: { kind: 'custom_domain_campaign', code: CAMPAIGN_COUPON_CODE },
    })
  }
  let promo = await findPromotionCode(coupon.id)
  if (!promo) {
    promo = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: PROMO_CODE,
      metadata: { kind: 'custom_domain_campaign' },
    })
  }
  return toStatus(coupon, promo)
}

/** Read-only campaign status for the admin console (n/100 counter). */
export async function getCampaignCouponStatus(): Promise<CampaignCouponStatus> {
  const coupon = await findCoupon()
  if (!coupon) return EMPTY
  const promo = await findPromotionCode(coupon.id)
  return toStatus(coupon, promo)
}

/**
 * Resolve a seller/agent-supplied code to the Stripe promotion-code id to apply
 * at checkout, or a typed refusal. The pure `couponRedeemable` rule mirrors the
 * cap Stripe enforces, so the seller gets a clean message before the redirect.
 */
export async function resolveCampaignPromotionCode(
  input: unknown,
): Promise<{ ok: true; promotionCodeId: string } | { ok: false; reason: CouponRefusalReason }> {
  if (!isCampaignCode(input)) return { ok: false, reason: 'unknown' }
  const status = await getCampaignCouponStatus()
  if (!status.exists || !status.promotion_code_id) return { ok: false, reason: 'unknown' }
  const redeemable = couponRedeemable({
    active: status.active,
    timesRedeemed: status.redeemed,
    maxRedemptions: status.cap,
  })
  return redeemable
    ? { ok: true, promotionCodeId: status.promotion_code_id }
    : { ok: false, reason: 'exhausted' }
}
