/**
 * lib/correos-tariff.ts
 *
 * Frontend twin of `apps/backend/src/lib/correos-tariff.ts` — shipping-provider-expansion
 * Sprint 3, Story 3.1/3.2. Kept byte-for-byte in step with the backend seam (same
 * convention as `lib/rental-pricing.ts`), so the seller-settings rate preview computes
 * instantly with no round trip. Pure, `next/*`-free.
 *
 * Source: local copy `references/correos-de-mexico-impresos.pdf` (sheet titled "TARIFA
 * POSTAL 2026"). The Impresos band schedule's own printed vigencia is 24 de febrero de
 * 2010 — it has been stable since. Flat NATIONAL rate — no zones. IVA (16%) is already
 * included in each band's total.
 */

export type CorreosTariffBand = {
  /** Inclusive upper edge, grams ("hasta X gramos"). */
  maxGrams: number
  /** IVA-inclusive total, in cents. */
  totalCents: number
}

export const CORREOS_IMPRESOS_VIGENCIA = '2010-02-24'

export const CORREOS_IMPRESOS_BANDS_2026: ReadonlyArray<CorreosTariffBand> = [
  { maxGrams: 20, totalCents: 600 },
  { maxGrams: 40, totalCents: 700 },
  { maxGrams: 60, totalCents: 800 },
  { maxGrams: 80, totalCents: 900 },
  { maxGrams: 100, totalCents: 950 },
  { maxGrams: 150, totalCents: 1050 },
  { maxGrams: 200, totalCents: 1150 },
  { maxGrams: 250, totalCents: 1350 },
  { maxGrams: 300, totalCents: 1450 },
  { maxGrams: 350, totalCents: 1550 },
  { maxGrams: 400, totalCents: 1700 },
  { maxGrams: 450, totalCents: 1800 },
  { maxGrams: 500, totalCents: 1850 },
  { maxGrams: 600, totalCents: 1900 },
  { maxGrams: 700, totalCents: 2000 },
  { maxGrams: 800, totalCents: 2050 },
  { maxGrams: 900, totalCents: 2150 },
  { maxGrams: 1000, totalCents: 2250 },
  { maxGrams: 1100, totalCents: 2300 },
  { maxGrams: 1200, totalCents: 2350 },
  { maxGrams: 1300, totalCents: 2400 },
  { maxGrams: 1400, totalCents: 2450 },
  { maxGrams: 1500, totalCents: 2500 },
  { maxGrams: 1600, totalCents: 2600 },
  { maxGrams: 1700, totalCents: 2650 },
  { maxGrams: 1800, totalCents: 2700 },
  { maxGrams: 1900, totalCents: 2800 },
  { maxGrams: 2000, totalCents: 2900 },
] as const

/** The heaviest weight the Impresos table prices — over this, there is no quote (v1). */
export const CORREOS_IMPRESOS_MAX_GRAMS = CORREOS_IMPRESOS_BANDS_2026[CORREOS_IMPRESOS_BANDS_2026.length - 1].maxGrams

export type CorreosQuote = {
  totalCents: number
  /** The matched band's upper edge, grams — informational (e.g. for UI copy). */
  maxGrams: number
}

/**
 * Quote the Impresos en General rate for a piece of the given weight. Pure, never
 * throws. `null` when the weight is non-positive/non-finite or exceeds the table's max
 * band (2000 g) — the caller must never invent a price outside the published table.
 */
export function quoteCorreos(weightGrams: number): CorreosQuote | null {
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null
  const band = CORREOS_IMPRESOS_BANDS_2026.find((b) => weightGrams <= b.maxGrams)
  return band ? { totalCents: band.totalCents, maxGrams: band.maxGrams } : null
}
