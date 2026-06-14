/**
 * lib/inmueble-hero.ts
 *
 * PDP redesign (epic 01) — Sprint 5, S5.2 (inmuebles).
 *
 * Pure, next-free seam for the property PDP hero. A property buyer judges fit by
 * distribution + location first, so the page leads with a glanceable icon spec
 * row (recámaras · baños · m² · estacionamientos) and an approximate-zone map
 * link, with a primary "Agendar visita". The exact address is never exposed
 * pre-visit (privacy/safety) — the map links to a search of the zone/city string
 * the seller set as `location`, not coordinates.
 *
 * No JSX / no network → unit-tested in the `api` gate (`e2e/inmueble-hero.spec.ts`).
 * `InmuebleHero.tsx` renders these models; this module owns the decisions.
 */

export interface InmuebleIconSpec {
  /** Iconoir glyph name. */
  icon: string
  /** es-MX label. */
  label: string
  /** Display value (already unit-suffixed where relevant). */
  value: string
}

interface IconSpecDef {
  key: string
  icon: string
  label: string
  /** Large-magnitude numbers (m²) get es-MX thousands grouping. */
  group?: boolean
  unit?: string
}

// Read in this fixed order so the row is stable regardless of attr insertion order.
const ICON_SPEC_DEFS: IconSpecDef[] = [
  { key: 'bedrooms', icon: 'iconoir-bed', label: 'Recámaras' },
  { key: 'bathrooms', icon: 'iconoir-bathroom', label: 'Baños' },
  { key: 'area_m2', icon: 'iconoir-ruler', label: 'Superficie', group: true, unit: 'm²' },
  { key: 'parking_spots', icon: 'iconoir-parking', label: 'Estac.' },
]

function isFilled(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  return true
}

function formatNumber(raw: unknown, group: boolean, unit?: string): string {
  const s = String(raw).trim()
  let str = s
  if (group && /^\d+(\.\d+)?$/.test(s)) str = Number(s).toLocaleString('es-MX')
  return unit ? `${str} ${unit}` : str
}

/**
 * The glanceable property icon-spec row from the listing's `attrs` bag. Skips
 * absent values; yields [] when none of the four keys are filled.
 */
export function inmuebleIconSpecs(attrs: Record<string, unknown> | null | undefined): InmuebleIconSpec[] {
  const bag = attrs ?? {}
  const specs: InmuebleIconSpec[] = []
  for (const def of ICON_SPEC_DEFS) {
    const raw = bag[def.key]
    if (!isFilled(raw)) continue
    specs.push({ icon: def.icon, label: def.label, value: formatNumber(raw, !!def.group, def.unit) })
  }
  return specs
}

/**
 * An approximate-zone maps URL (Google Maps search of the zone/city string).
 * Returns null when there's no location — never builds a link from an exact
 * address (the listing only carries a coarse `location`, by design).
 */
export function zoneMapUrl(location: string | null | undefined): string | null {
  const zone = location?.trim()
  if (!zone) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(zone)}`
}

export interface InmuebleHeroInput {
  /** Cal.com booking_url or the first scheduling link, already resolved on the page. */
  bookingUrl: string | null
}

export interface InmuebleHeroModel {
  /** The seller exposes a live calendar → the primary CTA links out to it. */
  hasSchedule: boolean
  /** es-MX primary-action label ("Agendar visita" / "Solicitar visita"). */
  primaryLabel: string
}

export function inmuebleHeroModel(input: InmuebleHeroInput): InmuebleHeroModel {
  const hasSchedule = !!(input.bookingUrl && input.bookingUrl.trim())
  return {
    hasSchedule,
    primaryLabel: hasSchedule ? 'Agendar visita' : 'Solicitar visita',
  }
}
