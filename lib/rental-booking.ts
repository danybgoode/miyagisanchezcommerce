/**
 * lib/rental-booking.ts
 *
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 2, Story 2.3.
 *
 * Frontend mirror of the backend's order-metadata reader (`apps/backend/src/lib/rental-booking.ts`)
 * — the shape `normalizeMedusaOrder` stamps as `rental_booking`/`rental_booking_state` on every
 * order read. This is the ONE seam all 5 rendering surfaces (buyer + seller order pages, both
 * confirmation emails, in-chat ledger) import from, so the dates/deposit text is formatted
 * identically everywhere using `lib/rental-pricing.ts`'s own helpers — never re-derived per surface.
 *
 * Pure / no `next/*` — unit-tested in `e2e/rental-booking.spec.ts`.
 */

import { toRatePeriod, rentalUnitsLabel, ratePeriodLabel, formatRentalCents, type RatePeriod } from './rental-pricing'

/** The structured block `normalizeMedusaOrder` exposes as `order.rental_booking`. */
export interface RentalBookingLike {
  check_in: string
  check_out: string
  nights: number
  units: number
  rate_period: RatePeriod | string
  rate_cents: number
  rent_cents: number
  deposit_cents: number
  total_cents: number
}

/** `order.rental_booking_state` — presence-based, not a multi-step machine. */
export type RentalBookingState = 'none' | 'reservado'

export interface RentalBookingLines {
  /** e.g. "2026-08-01 → 2026-08-03". */
  dates: string
  /** e.g. "3 noches × $1,200 = $3,600". */
  breakdown: string
  /** e.g. "Depósito reembolsable: $2,000" — null when the booking has no deposit. */
  deposit: string | null
  /** e.g. "$5,600". */
  total: string
}

/** Formats a rental booking block into display-ready lines, es-MX. Never re-derives
 *  the math or currency formatting — delegates entirely to `lib/rental-pricing.ts`. */
export function formatRentalBookingLines(rb: RentalBookingLike, currency: string): RentalBookingLines {
  const period = toRatePeriod(rb.rate_period)
  const unitLabel = rentalUnitsLabel(rb.units, period)
  return {
    dates: `${rb.check_in} → ${rb.check_out}`,
    breakdown: `${formatRentalCents(rb.rate_cents, currency)} × ${unitLabel} = ${formatRentalCents(rb.rent_cents, currency)}`,
    deposit: rb.deposit_cents > 0 ? `Depósito reembolsable: ${formatRentalCents(rb.deposit_cents, currency)}` : null,
    total: formatRentalCents(rb.total_cents, currency),
  }
}

/** es-MX badge label for the booking state. */
export function rentalBookingBadge(state: RentalBookingState): string {
  return state === 'reservado' ? '📅 Reservado' : 'Sin reservar'
}

// Re-exported for callers that only need the period label alongside the lines
// above (e.g. a compact one-line summary) without re-importing rental-pricing.
export { ratePeriodLabel }
