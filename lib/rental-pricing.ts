/**
 * lib/rental-pricing.ts
 *
 * PDP redesign (epic 01) — Sprint 4, S4.2 (rentals).
 *
 * Pure, next-free seam for the rental booking total. A rental PDP lets the buyer
 * pick a check-in / check-out range; this module turns that range + the seller's
 * per-period rate + deposit into the EXACT total shown beside the price and in the
 * action bar (`días × precio + depósito`). No JSX / no network / no `next/*` →
 * unit-testable in the `api` gate (`e2e/rental-pricing.spec.ts`). The displayed
 * totals must be exact, so the math lives here as the single source of truth for
 * both the client island and its spec.
 */

export type RatePeriod = 'dia' | 'semana' | 'mes'

/** Nights covered by one billed unit of each rate period. */
const NIGHTS_PER_UNIT: Record<RatePeriod, number> = { dia: 1, semana: 7, mes: 30 }

export interface RentalPriceInput {
  /** Rate per period, in cents (the listing price). */
  rateCents: number
  /** Refundable deposit in cents (0 when the seller set none). */
  depositCents: number
  /** Nights in the selected range (see `nightsBetween`). */
  nights: number
  /** What the rate is per — defaults to día. */
  period: RatePeriod
}

export interface RentalPrice {
  period: RatePeriod
  nights: number
  /** Billed units (e.g. 3 noches → 3 días; 10 noches semanal → 2 semanas). */
  units: number
  /** units × rateCents. */
  rentCents: number
  depositCents: number
  /** rentCents + depositCents — the bar total. */
  totalCents: number
}

/** Normalise an arbitrary stored value to a known rate period (default día). */
export function toRatePeriod(raw: unknown): RatePeriod {
  return raw === 'semana' || raw === 'mes' ? raw : 'dia'
}

/**
 * Whole nights between two YYYY-MM-DD dates. 0 when either is missing/invalid or
 * the range is non-positive (check-out ≤ check-in). UTC math so it never shifts
 * by a day across timezones / DST.
 */
export function nightsBetween(checkIn: string | null | undefined, checkOut: string | null | undefined): number {
  if (!checkIn || !checkOut) return 0
  const a = Date.parse(`${checkIn}T00:00:00Z`)
  const b = Date.parse(`${checkOut}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  const nights = Math.round((b - a) / 86_400_000)
  return nights > 0 ? nights : 0
}

/** Billed units for a night count at a given period (ceil — a partial period bills whole). */
export function rentalUnits(nights: number, period: RatePeriod): number {
  if (nights <= 0) return 0
  return Math.ceil(nights / NIGHTS_PER_UNIT[period])
}

/**
 * The exact rental total. `rentCents = units × rateCents`, `totalCents = rent +
 * deposit`. A non-positive range yields units 0 → rent 0 (deposit still shown so
 * the buyer sees it before picking dates).
 */
export function computeRentalTotal(input: RentalPriceInput): RentalPrice {
  const rate = Math.max(0, Math.round(input.rateCents || 0))
  const deposit = Math.max(0, Math.round(input.depositCents || 0))
  const nights = input.nights > 0 ? Math.floor(input.nights) : 0
  const units = rentalUnits(nights, input.period)
  const rentCents = units * rate
  return {
    period: input.period,
    nights,
    units,
    rentCents,
    depositCents: deposit,
    totalCents: rentCents + deposit,
  }
}

/** es-MX label for the billed units, e.g. "3 noches", "2 semanas", "1 mes". */
export function rentalUnitsLabel(units: number, period: RatePeriod): string {
  if (period === 'semana') return `${units} ${units === 1 ? 'semana' : 'semanas'}`
  if (period === 'mes') return `${units} ${units === 1 ? 'mes' : 'meses'}`
  return `${units} ${units === 1 ? 'noche' : 'noches'}`
}

/** es-MX singular noun for the rate period — "/día", "/semana", "/mes". */
export function ratePeriodLabel(period: RatePeriod): string {
  return period === 'semana' ? 'semana' : period === 'mes' ? 'mes' : 'día'
}

/** Exact es-MX currency string (no fractional pesos, matching the rest of the PDP). */
export function formatRentalCents(cents: number, currency = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
