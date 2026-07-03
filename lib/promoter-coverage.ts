/**
 * Promoter Funnel v2 · Sprint 5 (US-5.3) — the zine coverage honesty matcher.
 *
 * Next-free + dependency-free (no supabase, no `next/*`) so it's directly
 * unit-testable (e2e/promoter-coverage.spec.ts) and safely importable from a
 * client component (the check runs client-side in the print-ad close step,
 * US-5.4, against an already-fetched edition's public `coverage_zones`).
 *
 * `coverage_zones` is a free-form array of neighborhood/colonia strings (see
 * the `print_edition` migration) — there is no standardized geography behind
 * it, so this is deliberately a v1 substring matcher, not a geocoding project.
 * Unknown/missing data on either side is treated as NOT in coverage (the
 * caller shows the honesty notice) — informative only, never blocking.
 */

export interface ShopCoverageLocation {
  estado?: string | null
  municipio?: string | null
  colonias?: string[]
}

export interface CoverageMatchResult {
  inCoverage: boolean
  matchedZone: string | null
}

export const COVERAGE_NOTICE_TEXT =
  'Esta edición no cubre esta zona de forma dirigida — sirve como branding y presencia; ' +
  'cubrimos puntos estratégicos de distribución.'

/** Lowercase, strip accents, trim, collapse whitespace — for tolerant comparison. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Case-insensitive/accent-normalized bidirectional substring match between the
 * shop's {municipio, colonias[]} and each `coverage_zones[]` entry ("Roma"
 * matches "Colonia Roma Norte" and vice versa). Estado is deliberately NOT
 * matched — a state-wide "cobertura" claim is too coarse and would defeat the
 * honesty notice's whole purpose.
 */
export function matchesCoverage(shop: ShopCoverageLocation, coverageZones: string[]): CoverageMatchResult {
  const zones = (coverageZones ?? []).map((z) => z?.trim()).filter((z): z is string => !!z)
  if (zones.length === 0) return { inCoverage: false, matchedZone: null }

  const candidates = [shop.municipio, ...(shop.colonias ?? [])]
    .map((c) => c?.trim())
    .filter((c): c is string => !!c)
  if (candidates.length === 0) return { inCoverage: false, matchedZone: null }

  const normalizedCandidates = candidates.map(normalize)

  for (const zone of zones) {
    const nz = normalize(zone)
    if (!nz) continue
    const hit = normalizedCandidates.some((nc) => nc.includes(nz) || nz.includes(nc))
    if (hit) return { inCoverage: true, matchedZone: zone }
  }

  return { inCoverage: false, matchedZone: null }
}
