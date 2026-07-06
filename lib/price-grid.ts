/**
 * Custom print products — price-grid deriver.
 *
 * Data: seller-defined quantity price tiers per variant, fetched ONCE from
 * `GET /store/listings/:id/price-grid` (reads Medusa's own Price rows — see
 * `apps/backend/.../listings/[id]/price-grid/route.ts`). This module is a
 * PURE deriver over that already-fetched ladder — no network calls. The
 * actual charged price always comes from Medusa's own cart/checkout price
 * resolution (verified quantity-tier-correct — sprint-2.md's verify-first
 * finding); this module only keeps the PDP/cart DISPLAY in sync with it
 * instantly, before and between network round-trips.
 *
 * No new tables — mirrors lib/personalization.ts's discipline: pure
 * functions, defensive parsing that never throws, one shared formatter.
 */

export interface PriceGridTier {
  min_quantity: number
  max_quantity: number | null
  amount: number
}

export interface PriceGridVariant {
  id: string
  options: Record<string, string>
  manage_inventory: boolean
  tiers: PriceGridTier[]
}

export interface PriceGrid {
  product_id: string
  variants: PriceGridVariant[]
}

// ── Sanitisation ────────────────────────────────────────────────────────────

/** Validate + sort a raw tier array. Drops malformed entries. Never throws. */
export function sanitizeTierLadder(raw: unknown): PriceGridTier[] {
  if (!Array.isArray(raw)) return []
  const tiers: PriceGridTier[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const tt = t as Record<string, unknown>
    const minQuantity = Number(tt.min_quantity)
    const amount = Number(tt.amount)
    if (!Number.isFinite(minQuantity) || minQuantity < 1 || !Number.isFinite(amount) || amount <= 0) continue
    const maxQuantityRaw = tt.max_quantity
    const maxQuantity = maxQuantityRaw == null ? null : Number(maxQuantityRaw)
    tiers.push({
      min_quantity: Math.floor(minQuantity),
      max_quantity: maxQuantity != null && Number.isFinite(maxQuantity) ? Math.floor(maxQuantity) : null,
      amount,
    })
  }
  return tiers.sort((a, b) => a.min_quantity - b.min_quantity)
}

/** Narrow an unknown API response (`{price_grid: {...}}` or the bare object) into a PriceGrid, or null. Never throws. */
export function readPriceGrid(value: unknown): PriceGrid | null {
  if (!value || typeof value !== 'object') return null
  const outer = value as Record<string, unknown>
  const v = (outer.price_grid && typeof outer.price_grid === 'object' ? outer.price_grid : outer) as Record<string, unknown>

  const productId = typeof v.product_id === 'string' ? v.product_id : null
  if (!productId || !Array.isArray(v.variants)) return null

  const variants: PriceGridVariant[] = []
  for (const raw of v.variants) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    if (!id || !r.options || typeof r.options !== 'object') continue
    const tiers = sanitizeTierLadder(r.tiers)
    if (tiers.length === 0) continue
    variants.push({
      id,
      options: r.options as Record<string, string>,
      manage_inventory: r.manage_inventory === true,
      tiers,
    })
  }
  return { product_id: productId, variants }
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** The tier whose [min_quantity, max_quantity] range contains `quantity`, or null. */
export function resolveTierForQuantity(tiers: PriceGridTier[], quantity: number): PriceGridTier | null {
  const qty = Math.max(1, Math.floor(quantity) || 1)
  for (const tier of tiers) {
    if (qty >= tier.min_quantity && (tier.max_quantity === null || qty <= tier.max_quantity)) {
      return tier
    }
  }
  return null
}

/** The variant whose option combo exactly matches `selectedOptions`, or null. */
export function resolveVariantForOptions(
  grid: PriceGrid,
  selectedOptions: Record<string, string>,
): PriceGridVariant | null {
  return (
    grid.variants.find((v) => {
      const keys = Object.keys(v.options)
      return (
        keys.length === Object.keys(selectedOptions).length &&
        keys.every((k) => v.options[k] === selectedOptions[k])
      )
    }) ?? null
  )
}

/** Unit price (cents) for a specific variant + quantity, or null if unresolvable (e.g. quantity below every tier's min). */
export function unitPriceCentsFor(grid: PriceGrid, variantId: string, quantity: number): number | null {
  const variant = grid.variants.find((v) => v.id === variantId)
  if (!variant) return null
  return resolveTierForQuantity(variant.tiers, quantity)?.amount ?? null
}

// ── Formatting (es-MX; mirrors lib/listings.ts's formatPrice) ───────────────

export function formatPriceGridAmount(cents: number, currency = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100)
}

/** "Label: value" lines for a selected combo — reused by any surface that echoes it (cart, checkout, order). */
export function formatOptionsLines(options: Record<string, string>): string[] {
  return Object.entries(options).map(([title, value]) => `${title}: ${value}`)
}
