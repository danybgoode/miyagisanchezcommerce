/**
 * lib/ml-import.ts
 *
 * Pure, dependency-free mapping seam for Mercado Libre import (epic 03 ·
 * mercadolibre-sync, Sprint 2 · US-5). Maps a sanitised ML item (the wire shape
 * emitted by the backend `GET /internal/ml/items`) into the supply pipeline's
 * `IncomingSupplyItem`, so ML rides the existing catalog-import plumbing without
 * new ingestion code.
 *
 * No next/* and no network imports — the Playwright `api` runner unit-tests it.
 * Every field degrades gracefully: a missing/odd ML field never throws and never
 * produces a broken product.
 */
import type { IncomingSupplyItem } from './supply'
import type { CategoryKey } from './types'

/** The import-ready item shape the backend route emits (mirror of MlImportItem). */
export type MlImportItem = {
  id: string
  title: string
  category_id: string | null
  price: number | null // pesos (ML quotes major units)
  currency_id: string | null
  available_quantity: number | null
  condition: string | null // 'new' | 'used' | 'not_specified' | ...
  permalink: string | null
  description: string
  pictures: { url: string }[]
  attributes: { id: string | null; name: string | null; value_name: string | null }[]
  already_linked: boolean
}

/**
 * Static best-effort map from ML Mexico (MLM) **top-level** category ids to a
 * Miyagi category key. ML item details carry a *leaf* category id, which usually
 * won't match a top-level id here — those fall back to 'otros', and the seller
 * re-categorises in the review step (US-6). The accurate predictor that resolves
 * the leaf → its root is Sprint 3 / US-9; this is the safe, no-network default.
 */
const ML_TOPLEVEL_TO_MIYAGI: Record<string, CategoryKey> = {
  MLM1743: 'autos', // Autos, Motos y Otros
  MLM1459: 'inmuebles', // Inmuebles
  MLM1051: 'electronica', // Celulares y Teléfonos
  MLM1648: 'electronica', // Computación
  MLM1000: 'electronica', // Electrónica, Audio y Video
  MLM1144: 'electronica', // Consolas y Videojuegos
  MLM1574: 'hogar', // Hogar, Muebles y Jardín
  MLM1430: 'moda', // Ropa y Accesorios
  MLM1276: 'deportes', // Deportes y Fitness
  MLM1540: 'servicios', // Servicios
  MLM1071: 'mascotas', // Animales y Mascotas
  MLM1499: 'herramientas', // Industrias y Oficinas
  MLM1367: 'creatividad', // Antigüedades y Colecciones
}

/** Map an ML category id → Miyagi category key (best-effort, 'otros' fallback). */
export function mlCategoryToMiyagi(categoryId: string | null | undefined): CategoryKey {
  if (!categoryId) return 'otros'
  return ML_TOPLEVEL_TO_MIYAGI[categoryId] ?? 'otros'
}

/** Map an ML condition → a Miyagi import condition (undefined when unknown). */
export function mlConditionToMiyagi(
  condition: string | null | undefined,
): 'new' | 'good' | undefined {
  if (condition === 'new') return 'new'
  if (condition === 'used') return 'good'
  return undefined
}

/**
 * ML quotes prices in MAJOR units (pesos). `normalizePriceCents` (in lib/supply)
 * uses a >1,000,000 heuristic to guess pesos-vs-cents, which misreads either
 * extreme — so route each price through the branch that's correct for it:
 *   pesos ≤ 1,000,000 → pass `price` (×100 by the heuristic),
 *   pesos > 1,000,000 → pass `price_cents` (already >1M, kept as-is).
 * This keeps high-value listings (inmuebles, autos) accurate, no heuristic loss.
 */
function applyPrice(out: IncomingSupplyItem, pesos: number | null): void {
  if (pesos == null || !Number.isFinite(pesos) || pesos < 0) return
  if (pesos <= 1_000_000) out.price = pesos
  else out.price_cents = Math.round(pesos * 100)
}

/** Map a sanitised ML item → the supply pipeline's IncomingSupplyItem. */
export function mlItemToIncomingSupplyItem(item: MlImportItem): IncomingSupplyItem {
  const title = (item.title ?? '').trim()
  const images = Array.isArray(item.pictures)
    ? item.pictures.filter((p) => p && typeof p.url === 'string' && p.url.length > 0).map((p) => ({ url: p.url }))
    : []

  const out: IncomingSupplyItem = {
    source_id: item.id,
    source_url: item.permalink ?? undefined,
    listing_title: title || undefined,
    listing_description: item.description?.trim() || undefined,
    currency: (item.currency_id ?? 'MXN') || 'MXN',
    listing_type: 'product',
    category: mlCategoryToMiyagi(item.category_id),
    images,
    metadata: {
      ml_item_id: item.id,
      ml_category_id: item.category_id ?? null,
      ml_attributes: Array.isArray(item.attributes) ? item.attributes : [],
    },
  }

  applyPrice(out, item.price)

  const condition = mlConditionToMiyagi(item.condition)
  if (condition) out.condition = condition

  return out
}
