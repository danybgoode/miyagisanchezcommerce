/**
 * lib/domain-coupon.ts
 *
 * The PURE seam for the custom-domain campaign coupon `miyagisan` (epic 07 ·
 * custom-domain-paywall, Sprint 3 — the World-Cup acquisition giveaway). The
 * coupon comps the FIRST YEAR of the custom-domain subscription (100% off the
 * first interval, then it renews at the standard $499 MXN/yr) and is capped at
 * 100 total redemptions — the 101st is refused.
 *
 * The coupon itself lives in STRIPE (a Coupon + Promotion Code on the platform
 * account); Stripe enforces the cap authoritatively via `max_redemptions`. This
 * module holds only the PURE, next-free decision logic — code matching, the
 * redeemable/refusal rules, and the display counter — so the Playwright `api`
 * runner can unit-test the cap-of-100 boundary directly (no Stripe, no network).
 * The Stripe side lives in `lib/domain-coupon-server.ts`.
 *
 * Mirrors the `domain-entitlement.ts` (pure) / `domain-entitlement-server.ts`
 * (server) split used elsewhere in this epic.
 */

/** The single campaign code. Lowercase canonical form. */
export const CAMPAIGN_COUPON_CODE = 'miyagisan'

/** Total redemptions allowed across the whole campaign. The 101st is refused. */
export const CAMPAIGN_COUPON_CAP = 100

/** Why a campaign-coupon application was refused (null ⇒ not refused). */
export type CouponRefusalReason = 'exhausted' | 'unknown'

/** Normalize buyer/seller-typed input: trim + lowercase so " MIYAGISAN " matches. */
export function normalizeCouponCode(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : ''
}

/** True iff the input (after normalization) is the campaign code. */
export function isCampaignCode(input: unknown): boolean {
  return normalizeCouponCode(input) === CAMPAIGN_COUPON_CODE
}

/**
 * Is the campaign coupon still redeemable, given Stripe's live counters?
 * `active` is the promotion-code/coupon active flag; `timesRedeemed` and
 * `maxRedemptions` come straight from the Stripe coupon. Mirrors Stripe's own
 * server-side rule so our pre-check message matches what Stripe would enforce.
 */
export function couponRedeemable(input: {
  active: boolean
  timesRedeemed: number
  maxRedemptions: number
}): boolean {
  if (!input.active) return false
  return input.timesRedeemed < input.maxRedemptions
}

/**
 * Decide whether an applied code is refused and why.
 *  - not the campaign code ⇒ 'unknown'
 *  - campaign code but exhausted/inactive ⇒ 'exhausted'
 *  - otherwise ⇒ null (proceed)
 */
export function couponRefusalReason(
  input: unknown,
  status: { active: boolean; timesRedeemed: number; maxRedemptions: number },
): CouponRefusalReason | null {
  if (!isCampaignCode(input)) return 'unknown'
  return couponRedeemable(status) ? null : 'exhausted'
}

/** Display counter for the admin console, e.g. "7/100". */
export function formatRedemptionCount(redeemed: number, cap: number = CAMPAIGN_COUPON_CAP): string {
  return `${Math.max(0, redeemed)}/${cap}`
}

/** es-MX message for a refused application, by reason. */
export function couponRefusalMessage(reason: CouponRefusalReason): string {
  return reason === 'exhausted'
    ? `Se agotó el cupón “${CAMPAIGN_COUPON_CODE}”. Ya no hay años gratis disponibles.`
    : 'Cupón no válido.'
}
