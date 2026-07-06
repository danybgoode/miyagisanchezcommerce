/**
 * Custom print products — seller "Opciones" editor helpers (Story 2.4).
 *
 * Pure client-side mirrors of the backend contract in
 * `apps/backend/src/api/store/_utils/seller-product-create.ts` (combo key
 * format, dimension caps) and `apps/backend/src/lib/price-tiers.ts` (tier
 * ladder rules). The backend re-validates everything — these exist so the
 * editor can prevent invalid submissions and address per-combination prices
 * with the exact key the backend expects. Mirrors `lib/price-grid.ts`'s
 * discipline: pure functions, never throw.
 */

// Server-enforced caps (seller-product-create.ts) — keep in sync.
export const MAX_OPTION_DIMENSIONS = 3
export const MAX_VARIANT_COMBOS = 60
export const MAX_DIMENSION_TEXT_LEN = 40

export interface OptionDimension {
  title: string
  values: string[]
}

/**
 * Stable, sorted combo key — MUST byte-match the backend's
 * `buildVariantComboKey()` (titles sorted, `"Title:Value|Title:Value"`), since
 * it addresses each combination's price in the `variant_prices` payload.
 */
export function buildVariantComboKey(combo: Record<string, string>): string {
  return Object.keys(combo)
    .sort()
    .map((title) => `${title}:${combo[title]}`)
    .join('|')
}

/** Cartesian product of dimensions → one combo (Title→value map) per variant, first dimension varying slowest. */
export function cartesianCombos(dimensions: OptionDimension[]): Array<Record<string, string>> {
  return dimensions.reduce<Array<Record<string, string>>>(
    (combos, dim) =>
      combos.flatMap((combo) => dim.values.map((value) => ({ ...combo, [dim.title]: value }))),
    [{}],
  )
}

/**
 * Trim/cap titles and values the same way the backend does (trim, slice to 40
 * chars, drop empty values, de-dupe case-insensitively). Keeps dimensions with
 * no surviving values (the editor shows them as incomplete rather than
 * silently dropping a row the seller is mid-typing).
 */
export function sanitizeDimensions(raw: OptionDimension[]): OptionDimension[] {
  return raw.map((dim) => {
    const seen = new Set<string>()
    const values: string[] = []
    for (const rawValue of dim.values ?? []) {
      const value = (rawValue ?? '').trim().slice(0, MAX_DIMENSION_TEXT_LEN)
      if (!value) continue
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      values.push(value)
    }
    return { title: (dim.title ?? '').trim().slice(0, MAX_DIMENSION_TEXT_LEN), values }
  })
}

export type DimensionsValidation = { ok: true; combos: Array<Record<string, string>> } | { ok: false; message: string }

/**
 * Client pre-validation of sanitized dimensions — same rules the backend
 * enforces (`validateOptionDimensions`), es-MX messages, so the editor can
 * block a doomed submit before any request.
 */
export function validateDimensionsClient(dimensions: OptionDimension[]): DimensionsValidation {
  if (dimensions.length === 0) {
    return { ok: false, message: 'Agrega al menos una dimensión (por ejemplo, Tamaño).' }
  }
  if (dimensions.length > MAX_OPTION_DIMENSIONS) {
    return { ok: false, message: `Máximo ${MAX_OPTION_DIMENSIONS} dimensiones.` }
  }
  const seenTitles = new Set<string>()
  for (const dim of dimensions) {
    if (!dim.title) return { ok: false, message: 'Cada dimensión necesita un nombre (por ejemplo, Tamaño).' }
    const key = dim.title.toLowerCase()
    if (seenTitles.has(key)) return { ok: false, message: `La dimensión "${dim.title}" está repetida.` }
    seenTitles.add(key)
    if (dim.values.length === 0) {
      return { ok: false, message: `La dimensión "${dim.title}" necesita al menos un valor.` }
    }
  }
  const combos = cartesianCombos(dimensions)
  if (combos.length > MAX_VARIANT_COMBOS) {
    return { ok: false, message: `Demasiadas combinaciones (${combos.length}). Máximo ${MAX_VARIANT_COMBOS} — reduce dimensiones o valores.` }
  }
  return { ok: true, combos }
}

/** "150" / "150.50" / "1,500" (pesos) → integer cents, or null when not a positive amount. */
export function parsePesosToCents(raw: string): number | null {
  const n = parseFloat((raw ?? '').replace(/,/g, '').replace(/\s/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}
