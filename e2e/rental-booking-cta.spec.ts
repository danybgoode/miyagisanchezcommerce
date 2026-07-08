import { test, expect } from '@playwright/test'
import { resolveRentalBookingCta } from '../lib/rental-booking-cta'

/**
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 2, Story 2.2.
 *
 * The PDP's "Reservar estas fechas" CTA is driven entirely by this pure decision —
 * `RentalBooking.tsx` never inlines the flag/payment-method condition, so the
 * flag-OFF regression (today's AskSeller flow, byte-for-byte) is asserted directly
 * here rather than via a live SSR/flag-state fetch: `checkout.rental_pricing_enabled`
 * lives in the same Supabase `platform_flags` table shared with prod (no dev-scoped
 * credential), so flipping it for an automated spec would flip it for real users.
 */

const INPUT = { hasRange: true, listingId: 'prod_abc', checkIn: '2026-08-01', checkOut: '2026-08-03' }

test.describe('rental-booking-cta · resolveRentalBookingCta', () => {
  test('flag OFF → ask_seller (today\'s coordination flow, regardless of payment method)', () => {
    expect(resolveRentalBookingCta({ ...INPUT, rentalPricingEnabled: false, sellerHasPaymentMethod: true }).mode).toBe('ask_seller')
    expect(resolveRentalBookingCta({ ...INPUT, rentalPricingEnabled: false, sellerHasPaymentMethod: false }).mode).toBe('ask_seller')
  })

  test('flag ON but seller has no payment method → ask_seller', () => {
    expect(resolveRentalBookingCta({ ...INPUT, rentalPricingEnabled: true, sellerHasPaymentMethod: false }).mode).toBe('ask_seller')
  })

  test('flag ON + seller has a payment method + a date range is picked → checkout, with the exact dates in the href', () => {
    const result = resolveRentalBookingCta({ ...INPUT, rentalPricingEnabled: true, sellerHasPaymentMethod: true })
    expect(result.mode).toBe('checkout')
    if (result.mode !== 'checkout') return
    expect(result.href).toBe('/checkout?listingId=prod_abc&checkIn=2026-08-01&checkOut=2026-08-03')
  })

  test('no date range yet (hasRange false) → ask_seller even with the flag fully on', () => {
    const result = resolveRentalBookingCta({ ...INPUT, hasRange: false, rentalPricingEnabled: true, sellerHasPaymentMethod: true })
    expect(result.mode).toBe('ask_seller')
  })
})
