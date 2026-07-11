/**
 * lib/migration-estimate.ts
 *
 * Pure, unit-tested estimator for the `migration` promoter SKU above its flat
 * 150-listing cap (epic 03 · platform-migrations, Sprint 2 · US-2.2). Same
 * inputs ⇒ same total, on every surface — the merchant-visible estimate page,
 * the promoter close route, any future admin view. The close route reads the
 * STORED total this function produced (lib/migration-estimate-store.ts
 * persists it into `marketplace_migration_estimates`); it never recomputes
 * independently at close time — that split is the tamper-proof guarantee
 * ("the API is the guarantee, the UI is courtesy").
 *
 * No next/*, no server-only, no DB import — the Playwright `api` runner
 * unit-tests it directly (e2e/migrations-estimate.spec.ts), same shape as
 * lib/promoter-commission.ts#computeCommissionCents.
 */

/** Sprint 2's flat `migration` SKU price (admin-configured via marketplace_promoter_sku_prices, ≤150 listings). */
export const MIGRATION_BASE_PRICE_CENTS = 99_900 // $999 MXN
/** Above this many listings, the flat price no longer applies — use the estimate instead. */
export const MIGRATION_FLAT_LISTING_CAP = 150
/** Per listing beyond the cap. */
export const MIGRATION_OVERAGE_CENTS_PER_LISTING = 300 // $3 MXN
/** Per parity section rated 'partial' or 'none' (needs bespoke work beyond the standard import). */
export const MIGRATION_SECTION_ADDER_CENTS = 19_900 // $199 MXN

export interface MigrationEstimateInput {
  listingCount: number
  /** Count of parity sections rated 'partial' or 'none' — the sections needing bespoke build. */
  customSectionCount: number
}

export interface MigrationEstimateBreakdown {
  baseCents: number
  overageListings: number
  overageCents: number
  sectionAdderCents: number
  totalCents: number
}

/**
 * Deterministic tiered price: $999 base + $3/listing beyond 150 + $199 per
 * non-mapped parity section. Meaningful only ABOVE the flat cap — a caller at
 * or below 150 listings should charge the flat admin SKU price instead (this
 * function doesn't know about that business rule; it just computes a sane,
 * non-negative, non-throwing answer for any input). Negative/fractional
 * inputs are clamped, never thrown.
 */
export function computeMigrationEstimate(input: MigrationEstimateInput): MigrationEstimateBreakdown {
  const listingCount = Math.max(0, Math.trunc(input.listingCount || 0))
  const customSectionCount = Math.max(0, Math.trunc(input.customSectionCount || 0))

  const overageListings = Math.max(0, listingCount - MIGRATION_FLAT_LISTING_CAP)
  const overageCents = overageListings * MIGRATION_OVERAGE_CENTS_PER_LISTING
  const sectionAdderCents = customSectionCount * MIGRATION_SECTION_ADDER_CENTS
  const totalCents = MIGRATION_BASE_PRICE_CENTS + overageCents + sectionAdderCents

  return { baseCents: MIGRATION_BASE_PRICE_CENTS, overageListings, overageCents, sectionAdderCents, totalCents }
}
