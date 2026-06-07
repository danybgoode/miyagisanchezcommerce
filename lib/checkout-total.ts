/**
 * Checkout total — the single source of truth for the amount shown at checkout.
 * Pure + next-free so both the summary ("Total" row) and the pay button compute the
 * exact same number: the price must never appear to change at the moment of commit.
 *
 * items (already bundle-priced) − coupon discount + shipping, floored at 0.
 * The authoritative charge is computed server-side from the same inputs (the cart +
 * the coupon code); this is the client-side display contract.
 */

export interface CheckoutTotalInput {
  /** Line-items subtotal in cents (already reflects any bundle pricing). */
  itemsCents: number
  /** Coupon discount in cents (0 when none applied). */
  couponDiscountCents?: number
  /** Selected shipping rate in cents (0 when not shipping / not yet chosen). */
  shippingCents?: number
}

export function computeCheckoutTotal({
  itemsCents,
  couponDiscountCents = 0,
  shippingCents = 0,
}: CheckoutTotalInput): number {
  return Math.max(0, itemsCents - couponDiscountCents) + shippingCents
}
