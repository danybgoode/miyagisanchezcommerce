/**
 * Autos facet deriver (cars-vertical S1.1) — turns the backend `facet_pool`
 * (one compact entry per published autos listing, reconciled across both
 * metadata namespaces server-side) into the facet rail the browse UI renders:
 * marca / modelo options with honest full-catalog availability counts, and
 * año / precio / km numeric ranges.
 *
 * Pure + `next/*`-free so the Playwright `api` runner unit-tests it against
 * messy/missing/duplicate specs — the whole point is that real free-text seller
 * data (mixed casing, abbreviations, blank fields, non-numeric junk) still
 * produces a clean, honest rail.
 *
 * v1 counts are FULL-CATALOG AVAILABILITY (each option = total published autos
 * matching it, independent of the current selection). Cross-filtered narrowing
 * is a deliberate v2 non-goal.
 */

import { canonicalBrand, canonicalBrandKey } from './car-brands'

/** One car's facet-relevant fields — matches the backend `toCarFacetPoolEntry`. */
export interface CarFacetInput {
  make?: string | null
  model?: string | null
  year?: number | null
  km?: number | null
  price_cents?: number | null
}

export interface FacetOption {
  /** The value submitted as the filter param (?brand= / ?model=). */
  value: string
  /** es-MX display label. */
  label: string
  count: number
}

export interface NumRange {
  min: number
  max: number
}

export interface CarFacets {
  /** Size of the pool (total published autos). */
  total: number
  marca: FacetOption[]
  modelo: FacetOption[]
  /** Model year range; null when no car has a year. */
  anio: NumRange | null
  /** Price range in PESOS (matches the min_price/max_price params). */
  precio: NumRange | null
  /** Odometer range in km; null when no car has km. */
  km: NumRange | null
}

export interface DeriveCarFacetsOptions {
  /** When set, modelo options are scoped to this marca (any spelling/casing). */
  marca?: string | null
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function rangeOf(values: (number | null)[]): NumRange | null {
  const nums = values.filter((n): n is number => n != null)
  if (nums.length === 0) return null
  return { min: Math.min(...nums), max: Math.max(...nums) }
}

/** Sort options: most-common first, ties broken alphabetically (es-MX). */
function byCountThenLabel(a: FacetOption, b: FacetOption): number {
  return b.count - a.count || a.label.localeCompare(b.label, 'es')
}

export function deriveCarFacets(
  pool: CarFacetInput[],
  opts: DeriveCarFacetsOptions = {},
): CarFacets {
  const rows = Array.isArray(pool) ? pool : []

  // ── Marca — grouped by canonical key, counted, labeled with proper casing ──
  const marcaMap = new Map<string, { label: string; count: number }>()
  for (const r of rows) {
    const key = canonicalBrandKey(r.make)
    if (!key) continue
    const existing = marcaMap.get(key)
    if (existing) existing.count++
    else marcaMap.set(key, { label: canonicalBrand(r.make), count: 1 })
  }
  const marca: FacetOption[] = [...marcaMap.values()]
    .map(({ label, count }) => ({ value: label, label, count }))
    .sort(byCountThenLabel)

  // ── Modelo — optionally scoped to the selected marca; dedup on lowercased ──
  const selectedMarcaKey = opts.marca ? canonicalBrandKey(opts.marca) : ''
  const modeloMap = new Map<string, { label: string; count: number }>()
  for (const r of rows) {
    if (selectedMarcaKey && canonicalBrandKey(r.make) !== selectedMarcaKey) continue
    const raw = (r.model ?? '').trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    const existing = modeloMap.get(key)
    if (existing) existing.count++
    else modeloMap.set(key, { label: raw, count: 1 })
  }
  const modelo: FacetOption[] = [...modeloMap.values()]
    .map(({ label, count }) => ({ value: label, label, count }))
    .sort(byCountThenLabel)

  // ── Numeric ranges ──────────────────────────────────────────────────────────
  const anio = rangeOf(rows.map((r) => toNum(r.year)))
  const km = rangeOf(rows.map((r) => toNum(r.km)))
  const priceCents = rangeOf(rows.map((r) => toNum(r.price_cents)))
  const precio = priceCents
    ? { min: Math.floor(priceCents.min / 100), max: Math.ceil(priceCents.max / 100) }
    : null

  return { total: rows.length, marca, modelo, anio, precio, km }
}
