/**
 * lib/rental-booking-cta.ts
 *
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 2, Story 2.2.
 *
 * The pure decision behind the PDP's "Reservar estas fechas" CTA: deep-link
 * straight to checkout with the buyer's dates ONLY when online booking is fully
 * available (flag on + the seller has a payment method configured); otherwise
 * keep today's AskSeller coordination flow, byte-for-byte. `RentalBooking.tsx`
 * calls this to decide what to render — it never inlines the condition, so the
 * flag-OFF regression is asserted directly against this function.
 *
 * Pure / no `next/*` — unit-tested in `e2e/rental-booking-cta.spec.ts`.
 */

export interface RentalBookingCtaInput {
  /** Whether a valid date range is selected (mirrors `hasRange` in RentalBooking). */
  hasRange: boolean
  /** `checkout.rental_pricing_enabled`. */
  rentalPricingEnabled: boolean
  /** Whether the seller has ≥1 online/selectable payment path configured. */
  sellerHasPaymentMethod: boolean
  listingId: string
  checkIn: string
  checkOut: string
}

export type RentalBookingCta =
  | { mode: 'checkout'; href: string }
  | { mode: 'ask_seller' }

export function resolveRentalBookingCta(input: RentalBookingCtaInput): RentalBookingCta {
  if (input.hasRange && input.rentalPricingEnabled && input.sellerHasPaymentMethod) {
    // URLSearchParams, not raw template interpolation — a listing id/date is
    // trusted today, but this is a URL-construction seam and should encode
    // regardless (cross-agent review catch, 2026-07-08).
    const qs = new URLSearchParams({ listingId: input.listingId, checkIn: input.checkIn, checkOut: input.checkOut })
    return { mode: 'checkout', href: `/checkout?${qs.toString()}` }
  }
  return { mode: 'ask_seller' }
}
