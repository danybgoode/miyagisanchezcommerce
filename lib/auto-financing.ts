/**
 * lib/auto-financing.ts — cars-vertical S2.1/S2.2.
 *
 * Pure, next-free financing/warranty/inspection projections for autos
 * listings. Reused by AutoHero.tsx (PDP), the /l card chip (lib/listings.ts),
 * and the UCP catalog (lib/ucp/schema.ts) — keep this the ONLY place the
 * $/mes math lives, mirroring the repuveDisplay()/autoHeroModel() seam in
 * lib/auto-hero.ts (raw untyped input → typed display model or null).
 *
 * No JSX / no network → unit-tested in the `api` gate (e2e/auto-financing.spec.ts).
 */

/**
 * TODO(daniel): confirm exact copy pre-merge — epic DoD gate item, legal
 * sensitivity ($/mes must read as informative-only, never a credit offer).
 */
export const FINANCING_DISCLAIMER = 'Cálculo informativo, no es oferta de crédito.'

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export interface FinancingInput {
  /** Listing price in cents (Medusa convention). */
  priceCents: number | null | undefined
  /** Raw attrs.financing_down_payment_pct (string | number | undefined). */
  downPaymentPct: unknown
  /** Raw attrs.financing_months. */
  months: unknown
}

export interface FinancingDisplay {
  /** "$X,XXX/mes" es-MX currency-formatted. */
  monthlyLabel: string
  /** Raw monthly amount in cents (Medusa convention) — for a consumer that
   *  needs the number, not just the formatted label (e.g. the UCP catalog). */
  monthlyCents: number
  disclaimer: string
}

/**
 * Derive the "$X/mes" hint from a price + enganche % + term. Returns null
 * (renders nothing) when the price is missing, the down payment isn't a
 * percentage in [0, 100), or months isn't a positive integer — never throws,
 * never shows a broken/negative number.
 */
export function financingDisplay(input: FinancingInput): FinancingDisplay | null {
  const priceCents = input.priceCents
  if (priceCents == null || !Number.isFinite(priceCents) || priceCents <= 0) return null

  const pct = toFiniteNumber(input.downPaymentPct)
  if (pct == null || pct < 0 || pct >= 100) return null

  const months = toFiniteNumber(input.months)
  if (months == null || months <= 0) return null

  const financedCents = priceCents * (1 - pct / 100)
  const monthlyCents = Math.round(financedCents / months)
  if (!Number.isFinite(monthlyCents) || monthlyCents <= 0) return null

  const formatted = (monthlyCents / 100).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  })

  return {
    monthlyLabel: `${formatted}/mes`,
    monthlyCents,
    disclaimer: FINANCING_DISCLAIMER,
  }
}

export interface WarrantyInput {
  /** Raw attrs.warranty_text. */
  text: unknown
  /** Raw attrs.warranty_months. */
  months: unknown
}

export interface WarrantyDisplay {
  /** "Garantía: 6 meses" (months) or "Garantía" (text only). */
  chipLabel: string
  text: string | null
  months: number | null
}

/** Returns null when neither warranty field is present. */
export function warrantyDisplay(input: WarrantyInput): WarrantyDisplay | null {
  const text = typeof input.text === 'string' && input.text.trim() ? input.text.trim() : null
  const months = toFiniteNumber(input.months)
  const hasMonths = months != null && months > 0

  if (!text && !hasMonths) return null

  return {
    chipLabel: hasMonths ? `Garantía: ${months} meses` : 'Garantía',
    text,
    months: hasMonths ? months : null,
  }
}

export interface InspectionInput {
  /** Raw attrs.inspection_report_url. */
  url: unknown
}

export interface InspectionDisplay {
  url: string
}

/**
 * Returns null when the stored value is empty/whitespace/not http(s) — a
 * graceful degrade so a malformed stored value never renders a dead link.
 */
export function inspectionDisplay(input: InspectionInput): InspectionDisplay | null {
  if (typeof input.url !== 'string') return null
  const trimmed = input.url.trim()
  if (!trimmed) return null
  if (!/^https?:\/\//i.test(trimmed)) return null
  return { url: trimmed }
}
