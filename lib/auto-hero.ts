/**
 * lib/auto-hero.ts
 *
 * PDP redesign (epic 01) — Sprint 5, S5.1 (autos).
 *
 * Pure, next-free seam for the autos PDP hero. A car buyer's first anxiety is
 * fraud, so the page leads with the REPUVE verification (green "sin reporte" /
 * red "con reporte" + folio) and the vehicle specs, and the primary action is
 * "Agendar prueba de manejo" (test drive) rather than the boxed buy bar — the
 * buy/offer bar stays available below (a car is buyable), so this is a reorder +
 * primary-action emphasis, not a hero takeover.
 *
 * No JSX / no network → unit-tested in the `api` gate (`e2e/auto-hero.spec.ts`).
 * `AutoHero.tsx` renders the model; this module owns the decision so it can't
 * drift. The REPUVE display model mirrors the inline badge the legacy PDP showed
 * so the kill-switch reverts byte-for-byte.
 */

export interface RepuveDisplay {
  /** No REPUVE report on file → the reassuring green state. */
  clean: boolean
  /** es-MX badge label. */
  label: string
  /** "Folio: …" line when a folio is present, else null. */
  folioLabel: string | null
  /** Iconoir glyph name for the badge. */
  icon: string
}

/**
 * Project a stored `metadata.repuve` value onto its display model. Returns null
 * when there's no usable status (so the anchor simply doesn't render).
 */
export function repuveDisplay(repuve: { status?: string; folio?: string } | null | undefined): RepuveDisplay | null {
  const status = repuve?.status?.trim()
  if (!status) return null
  const clean = status === 'sin_reporte'
  const folio = repuve?.folio?.trim()
  return {
    clean,
    label: clean ? 'Sin reporte REPUVE' : 'Con reporte REPUVE',
    folioLabel: folio ? `Folio: ${folio}` : null,
    icon: clean ? 'iconoir-check-circle' : 'iconoir-warning-triangle',
  }
}

export interface AutoHeroInput {
  /** Cal.com booking_url or the first scheduling link, already resolved on the page. */
  bookingUrl: string | null
}

export interface AutoHeroModel {
  /** The seller exposes a live calendar → the primary CTA links out to it. */
  hasSchedule: boolean
  /** es-MX primary-action label ("Agendar prueba de manejo" / "Solicitar prueba de manejo"). */
  primaryLabel: string
}

export function autoHeroModel(input: AutoHeroInput): AutoHeroModel {
  const hasSchedule = !!(input.bookingUrl && input.bookingUrl.trim())
  return {
    hasSchedule,
    primaryLabel: hasSchedule ? 'Agendar prueba de manejo' : 'Solicitar prueba de manejo',
  }
}
