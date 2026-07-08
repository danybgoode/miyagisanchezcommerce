/**
 * lib/ucp/rental-quote.ts
 *
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 3, Story 3.1.
 *
 * The UCP-facing wrapper around `resolveRentalCheckoutDisplay` (S2.1's pure seam,
 * the SAME decision `/checkout`'s rental mode uses) — reused, not reimplemented, so
 * an agent's quote and the web checkout's quote can never drift. Adds only what the
 * UCP surface needs on top: an agent-legible rejection reason (the pure seam folds
 * "flag off" and "wrong listing type" into one boolean) and the UCP response shape.
 *
 * Pure / no `next/*` — unit-tested directly in `e2e/ucp-rental-quote.spec.ts`.
 */

import {
  toRatePeriod,
  readDepositCents,
  formatRentalCents,
  type RatePeriod,
} from '../rental-pricing'
import { resolveRentalCheckoutDisplay } from '../rental-checkout-display'

export interface UcpRentalQuote {
  check_in: string
  check_out: string
  nights: number
  units: number
  rate_period: RatePeriod
  rate_cents: number
  rent_cents: number
  deposit_cents: number
  total_cents: number
  formatted: string
}

export type UcpRentalQuoteResult =
  | { ok: true; quote: UcpRentalQuote }
  | { ok: false; reason: string }

export interface UcpRentalQuoteInput {
  /** `checkout.rental_pricing_enabled`. */
  enabled: boolean
  isRentalListing: boolean
  checkIn: string | null | undefined
  checkOut: string | null | undefined
  /** The listing's rate per period, in cents (its own price). */
  rateCents: number
  /** The product's `metadata.attrs` (rate_period + deposit-in-pesos live here). */
  attrs: Record<string, unknown> | null | undefined
  currency: string
  /** "Now", injectable for tests — defaults to `Date.now()`. */
  nowMs?: number
}

/**
 * Resolve a dated rental request to the UCP quote shape, or an agent-legible
 * rejection reason. Distinguishes the two cheap, unambiguous reasons up front
 * (a caller already knows the listing type and the flag state) — everything the
 * pure seam itself rejects (malformed dates, a rolled-over calendar date, a
 * past check-in, a non-positive range, a zero rate) buckets under one
 * `invalid_dates` reason, matching the granularity `resolveRentalCheckoutDisplay`
 * exposes.
 */
export function resolveUcpRentalQuote(input: UcpRentalQuoteInput): UcpRentalQuoteResult {
  if (!input.isRentalListing) {
    return { ok: false, reason: 'Este anuncio no es una renta — check_in/check_out no aplican.' }
  }
  if (!input.enabled) {
    return { ok: false, reason: 'La reserva en línea no está disponible todavía para este anuncio; contacta al vendedor para coordinar.' }
  }

  const result = resolveRentalCheckoutDisplay({
    enabled: input.enabled,
    isRentalListing: input.isRentalListing,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    rateCents: input.rateCents,
    attrs: input.attrs,
    nowMs: input.nowMs,
  })

  if (!result.ok) {
    return { ok: false, reason: 'check_in/check_out inválidos (formato YYYY-MM-DD, check_in no puede ser pasado, y check_out debe ser posterior a check_in) — no se generó una cotización.' }
  }

  const breakdown = result.breakdown
  const period = toRatePeriod((input.attrs ?? {}).rate_period)

  return {
    ok: true,
    quote: {
      check_in: input.checkIn as string,
      check_out: input.checkOut as string,
      nights: breakdown.nights,
      units: breakdown.units,
      rate_period: period,
      rate_cents: Math.max(0, Math.round(input.rateCents || 0)),
      rent_cents: breakdown.rentCents,
      deposit_cents: breakdown.depositCents,
      total_cents: breakdown.totalCents,
      formatted: formatRentalCents(breakdown.totalCents, input.currency),
    },
  }
}

/**
 * The date-less / non-rental hint: labels the rate clearly as per-period (never
 * the full price) and nudges toward the dated call. Only meaningful for a rental
 * listing — callers should not surface this for non-rental listings.
 */
export function rentalPricingHint(input: {
  rateCents: number
  attrs: Record<string, unknown> | null | undefined
  currency: string
}): string {
  const period = toRatePeriod((input.attrs ?? {}).rate_period)
  const periodLabel = period === 'semana' ? 'semana' : period === 'mes' ? 'mes' : 'día'
  const rate = formatRentalCents(Math.max(0, Math.round(input.rateCents || 0)), input.currency)
  const depositCents = readDepositCents(input.attrs)
  const depositPart = depositCents > 0 ? ` + depósito ${formatRentalCents(depositCents, input.currency)}` : ''
  return `Tarifa: ${rate} /${periodLabel}${depositPart}. Envía check_in y check_out (YYYY-MM-DD) para el total exacto reservable.`
}
