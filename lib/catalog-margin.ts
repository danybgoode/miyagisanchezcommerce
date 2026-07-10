/**
 * Catalog-table margin deriver — pure, next-free (catalog-management epic,
 * Sprint 4 · Story 4.1). Joins `lib/profit.ts`'s `computeSkuMarginsByChannel`
 * output onto a catalog listing's Miyagi/ML columns. No formula fork: every
 * number here is a straight sum of the SAME `SkuMarginRow` fields the ledger
 * already computed, and the margin-killer flag delegates to the already-
 * exported `classifyMarginKillers` rather than re-encoding its threshold.
 *
 * Three honest states per channel — never a fake/blank margin:
 * - `no_sales`  — no ledger row at all for this product+channel (the ledger
 *                 only ever produces a row once something sold; unsold
 *                 inventory is common and must not be confused with "sin COGS").
 * - `no_cogs`   — at least one matching row exists but its COGS piece is
 *                 still pending (seller never set a unit cost).
 * - `computed`  — a real margin, aggregated across every variant row this
 *                 product+channel has (a multi-variant product's per-variant
 *                 ledger rows collapse into one catalog-table cell).
 */
import { classifyMarginKillers, type ProfitSource, type SkuMarginRow, type PendingPiece } from './profit'

export type MarginCellState = 'no_sales' | 'no_cogs' | 'computed'

export interface MarginCell {
  state: MarginCellState
  marginCents?: number
  marginPct?: number | null
  isKiller: boolean
  /** Non-blocking pending pieces (e.g. 'ml_fee') to note alongside a computed
   * margin — mirrors the profit dashboard's own convention of showing the
   * number while still naming what's incomplete. Never includes 'cogs' —
   * that's the `no_cogs` state instead, not a note on a computed one. */
  pending: PendingPiece[]
}

export interface ProductMarginInfo {
  miyagi: MarginCell
  ml: MarginCell
}

const NO_SALES: MarginCell = { state: 'no_sales', isKiller: false, pending: [] }
const NO_COGS: MarginCell = { state: 'no_cogs', isKiller: false, pending: [] }

function cellFor(productId: string, source: ProfitSource, rows: SkuMarginRow[]): MarginCell {
  const matching = rows.filter((r) => r.product_id === productId && r.source === source)
  if (matching.length === 0) return NO_SALES
  if (matching.some((r) => r.pending.includes('cogs'))) return NO_COGS

  // Aggregate across this product's variant rows for the channel (a multi-
  // variant product collapses to one catalog-table cell) — same sum-based
  // math `lib/profit.ts` itself uses, not a new formula.
  const revenueCents = matching.reduce((acc, r) => acc + r.revenue_cents, 0)
  const feesCents = matching.reduce((acc, r) => acc + r.fees_cents, 0)
  const cogsCents = matching.reduce((acc, r) => acc + r.cogs_cents, 0)
  const marginCents = revenueCents - feesCents - cogsCents
  const marginPct = revenueCents > 0 ? marginCents / revenueCents : null
  const pending = [...new Set(matching.flatMap((r) => r.pending))].filter((p) => p !== 'cogs')

  const aggregatedRow: SkuMarginRow = {
    ...matching[0],
    revenue_cents: revenueCents,
    fees_cents: feesCents,
    cogs_cents: cogsCents,
    margin_cents: marginCents,
    margin_pct: marginPct,
    pending: [],
  }
  const isKiller = classifyMarginKillers([aggregatedRow]).length > 0

  return { state: 'computed', marginCents, marginPct, isKiller, pending }
}

/** One product's Miyagi + ML margin cells, derived from the per-channel ledger rows. */
export function deriveProductMargin(productId: string, rowsByChannel: SkuMarginRow[]): ProductMarginInfo {
  return {
    miyagi: cellFor(productId, 'native', rowsByChannel),
    ml: cellFor(productId, 'mercadolibre', rowsByChannel),
  }
}

/**
 * A product eligible for the bulk "apply suggested price" action (S4 ·
 * Story 4.2) — the Miyagi-channel single addressable variant + its realized
 * per-unit COGS, ready to feed `solveForPrice()`. Mirrors PricingCard's own
 * single-item precondition (a real variant_id, at least one sold unit, real
 * revenue) — bulk apply can only ever be as capable as the one-at-a-time
 * control it reuses the write path from.
 */
export interface SuggestedPriceCandidate {
  productId: string
  variantId: string
  costPerUnitCents: number
}

/**
 * Resolves the single Miyagi-channel margin row for a product, or null when
 * ineligible: zero matching rows (never sold — "no_sales"), more than one
 * matching row (a multi-variant product with sales on more than one
 * variant — genuinely ambiguous which price to solve for, mirrors the
 * backend's own multi-variant rejection in `computeBulkDiff`), a missing
 * `variant_id`, no realized units/revenue, or a pending COGS piece.
 */
export function resolveSuggestedPriceCandidate(productId: string, marginRowsByChannel: SkuMarginRow[]): SuggestedPriceCandidate | null {
  const matching = marginRowsByChannel.filter((r) => r.product_id === productId && r.source === 'native')
  if (matching.length !== 1) return null
  const row = matching[0]
  if (!row.variant_id || row.units <= 0 || row.revenue_cents <= 0 || row.pending.includes('cogs')) return null
  return { productId, variantId: row.variant_id, costPerUnitCents: Math.round(row.cogs_cents / row.units) }
}
