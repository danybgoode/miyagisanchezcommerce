/**
 * lib/rental-checkout-display.ts
 *
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 2, Story 2.1.
 *
 * The pure decision behind `/checkout`'s rental mode: given the buyer's dates + the
 * listing's own rate/attrs, either produce the same breakdown the PDP showed or
 * reject — the page redirects back to the PDP on rejection rather than falling
 * through to a single-unit charge. Mirrors the backend's `rental-checkout.ts`
 * separation (`rental-pricing.ts` stays pure math only).
 *
 * THE HARD RULE (tamper guarantee, matching the backend): this function's input has
 * NO amount field. The displayed (and later charged) total can only be derived from
 * the dates + the listing's own rate + attrs — there is no parameter to carry a
 * client-sent amount.
 *
 * Pure / no `next/*` — unit-tested in `e2e/rental-checkout.spec.ts`.
 */

import {
  toRatePeriod,
  nightsBetween,
  isValidYmd,
  readDepositCents,
  computeRentalTotal,
  type RentalPrice,
} from './rental-pricing'

export interface RentalCheckoutDisplayInput {
  /** `checkout.rental_pricing_enabled` — OFF ⇒ reject (today's coordination flow). */
  enabled: boolean
  /** The listing's resolved type — only `'rental'` can enter this mode. */
  isRentalListing: boolean
  /** ONLY the dates — deliberately no amount field (tamper guarantee). */
  checkIn: string | null | undefined
  checkOut: string | null | undefined
  /** The rate per period, in cents — the listing's own price. */
  rateCents: number
  /** The product's `metadata.attrs` (rate_period + deposit-in-pesos live here). */
  attrs: Record<string, unknown> | null | undefined
  /** UTC midnight "today" (ms), injectable for tests — defaults to `Date.now()`. */
  nowMs?: number
}

export type RentalCheckoutDisplayResult =
  | { ok: true; breakdown: RentalPrice }
  | { ok: false }

function todayUtcMs(nowMs: number): number {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Resolve a rental checkout to a display-ready breakdown, or reject. Validation
 * ladder: flag off → not a rental listing → invalid calendar dates → check-in in
 * the past → non-positive range → no rate → compute. Every rejection routes the
 * page back to the PDP (`?checkout=unavailable`), never a single-unit fallback.
 */
export function resolveRentalCheckoutDisplay(input: RentalCheckoutDisplayInput): RentalCheckoutDisplayResult {
  if (!input.enabled) return { ok: false }
  if (!input.isRentalListing) return { ok: false }

  const { checkIn, checkOut } = input
  if (!isValidYmd(checkIn) || !isValidYmd(checkOut)) return { ok: false }

  const nowMs = input.nowMs ?? Date.now()
  const checkInMs = Date.parse(`${checkIn}T00:00:00Z`)
  if (checkInMs < todayUtcMs(nowMs)) return { ok: false }

  const nights = nightsBetween(checkIn, checkOut)
  if (nights <= 0) return { ok: false }

  const rateCents = Math.round(Number(input.rateCents) || 0)
  if (rateCents <= 0) return { ok: false }

  const period = toRatePeriod((input.attrs ?? {}).rate_period)
  const depositCents = readDepositCents(input.attrs)
  const breakdown = computeRentalTotal({ rateCents, depositCents, nights, period })

  if (breakdown.totalCents <= 0) return { ok: false }

  return { ok: true, breakdown }
}
