/**
 * Car-brand canonicalization (cars-vertical S1.1) — mirrors the mx-locations.ts
 * pattern: a small curated map + a graceful `canonicalBrand(input)` that passes
 * unknown brands through unchanged.
 *
 * Two jobs:
 *  - `canonicalBrandKey(input)` — the stable comparison/dedup KEY. Merges common
 *    abbreviations (VW→Volkswagen) and normalizes casing/accents so the facet rail
 *    shows one option per real brand. **This is a MIRROR of the backend
 *    `_utils/car-listing.ts` `canonicalBrandKey` — the two alias tables MUST stay
 *    in sync**, so the honest facet count the rail shows matches what the backend
 *    `brand` filter returns when the option is clicked (same mirror discipline as
 *    isPrintPlacementListing ↔ the backend hidden-catalog check).
 *  - `canonicalBrand(input)` — the DISPLAY label. Known brands get their proper
 *    casing (BMW, SEAT, Mercedes-Benz); unknown brands pass through as typed.
 *
 * es-MX; `next/*`-free so the Playwright `api` runner can unit-test it.
 */

// Abbreviation / spelling aliases → canonical key. Only entries that DIFFER from
// their own normalized form need to live here (everything else keys to itself).
// KEEP IN SYNC with the backend BRAND_ALIAS_TO_KEY.
const BRAND_ALIAS_TO_KEY: Record<string, string> = {
  vw: 'volkswagen',
  chevy: 'chevrolet',
  mercedes: 'mercedes-benz',
  'mercedes benz': 'mercedes-benz',
  mercedesbenz: 'mercedes-benz',
  'general motors': 'gmc',
  'great wall': 'gwm',
}

// Canonical key → proper display casing. Only brands whose display differs from a
// naive capitalization need an entry; unknown brands fall back to the raw input.
const BRAND_DISPLAY: Record<string, string> = {
  volkswagen: 'Volkswagen',
  chevrolet: 'Chevrolet',
  nissan: 'Nissan',
  toyota: 'Toyota',
  honda: 'Honda',
  mazda: 'Mazda',
  hyundai: 'Hyundai',
  kia: 'Kia',
  ford: 'Ford',
  renault: 'Renault',
  seat: 'SEAT',
  suzuki: 'Suzuki',
  jeep: 'Jeep',
  mitsubishi: 'Mitsubishi',
  dodge: 'Dodge',
  ram: 'RAM',
  bmw: 'BMW',
  'mercedes-benz': 'Mercedes-Benz',
  audi: 'Audi',
  peugeot: 'Peugeot',
  chirey: 'Chirey',
  mg: 'MG',
  gmc: 'GMC',
  chrysler: 'Chrysler',
  fiat: 'Fiat',
  buick: 'Buick',
  volvo: 'Volvo',
  subaru: 'Subaru',
  acura: 'Acura',
  byd: 'BYD',
  jac: 'JAC',
  gwm: 'GWM',
  changan: 'Changan',
  cupra: 'Cupra',
  lincoln: 'Lincoln',
}

function normalizeBrand(input: string): string {
  return input.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
}

/** Stable comparison/dedup key for a brand — merges abbreviations + casing/accents. */
export function canonicalBrandKey(input: string | null | undefined): string {
  const k = normalizeBrand(input ?? '')
  if (!k) return ''
  return BRAND_ALIAS_TO_KEY[k] ?? k
}

/**
 * Display label for a brand: proper casing for known brands, else the input as
 * typed (graceful pass-through — an unknown brand is never dropped).
 */
export function canonicalBrand(input: string | null | undefined): string {
  const raw = (input ?? '').trim()
  if (!raw) return ''
  const key = canonicalBrandKey(raw)
  return BRAND_DISPLAY[key] ?? raw
}
