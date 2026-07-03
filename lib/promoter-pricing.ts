/**
 * Promoter Funnel v2 · Sprint 3 (US-3.1) — the per-SKU + bundle pricing deriver.
 *
 * Turns the admin config (a per-SKU promoter-price override, falling back to the
 * existing global discount formula — lib/promoter.ts computePromoterDiscountCents
 * — when unset) plus an optional bundle definition into the numbers every surface
 * shows: "todo esto cuesta $X — con tu promotor $Y", the per-item regular-vs-code
 * comparison, and the bundle savings. ONE deriver so the landing (S1.4), the
 * handbook, the close workspace, and the real checkout discount (lib/promoter.ts
 * resolvePromoterDiscount) never drift from each other.
 *
 * Pure + next-free (no `next/cache`, no `server-only`, no DB) — directly
 * unit-testable (e2e/promoter-pricing.spec.ts). The Supabase reads/writes for the
 * per-SKU prices + bundle config live in lib/promoter.ts, exactly like the
 * commission-rate seam. `PromoterSettings` is a TYPE-ONLY import from lib/promoter
 * (erased at compile time) — a VALUE import would cycle back (lib/promoter.ts
 * imports this module for the checkout-discount seam), the same ESM-cycle hazard
 * promoter-skus.ts documents. `legacyDiscountCents` therefore re-derives the tiny
 * fixed/percentage formula locally instead of importing
 * lib/promoter.ts#computePromoterDiscountCents — mirrors its exact shape
 * (e2e/promoter-program.spec.ts already covers that formula directly).
 */

import type { PromoterSettings } from '@/lib/promoter'
import { PROMOTER_SKUS, type PromoterSku } from '@/lib/promoter-skus'

/** Local mirror of lib/promoter.ts#computePromoterDiscountCents — see header note. */
function legacyDiscountCents(type: 'fixed' | 'percentage', amount: number, baseCents: number): number {
  if (baseCents <= 0 || amount <= 0) return 0
  const raw = type === 'percentage' ? Math.round((baseCents * amount) / 100) : Math.round(amount)
  return Math.max(0, Math.min(raw, baseCents))
}

/** sku → admin-set promoter price in whole MXN pesos. `null`/absent = not configured. */
export type PromoterSkuPrices = Partial<Record<PromoterSku, number | null>>

export interface BundleConfig {
  /** Which SKUs the bundle price covers. Empty ⇒ no bundle. */
  skus: PromoterSku[]
  /** Admin-set total price for buying every bundled SKU together. `null` ⇒ not configured. */
  bundlePriceMxn: number | null
}

// ── Per-SKU resolution (the checkout + display seam) ──────────────────────────

/**
 * Resolve one SKU's promoter price in cents. Priority:
 *   1. an explicit per-SKU override (`skuPrices[sku]`, whole MXN) — clamped to
 *      [0, regularPriceCents] so a bad admin value can never charge negative or
 *      more than list price;
 *   2. the legacy global discount formula (`discount_type`/`discount_amount_cents`)
 *      — UNCHANGED behavior for any SKU without an override, so existing checkout
 *      flows (custom_domain, ml_sync) never drift when this ships.
 * Never negative, never above the regular price.
 */
export function resolveSkuPromoterPriceCents(input: {
  sku: PromoterSku
  regularPriceCents: number
  skuPrices: PromoterSkuPrices
  settings: PromoterSettings
}): number {
  const { sku, regularPriceCents, skuPrices, settings } = input
  if (regularPriceCents <= 0) return 0
  const override = skuPrices[sku]
  if (override != null && Number.isFinite(override)) {
    return Math.max(0, Math.min(Math.round(override * 100), regularPriceCents))
  }
  const discountCents = legacyDiscountCents(settings.discount_type, settings.discount_amount_cents, regularPriceCents)
  return Math.max(0, regularPriceCents - discountCents)
}

export interface SkuPriceRow {
  sku: PromoterSku
  /** `print_ad` has no fixed price (admin-configured per-tier) — degrades to this. */
  variablePrice: boolean
  regularPriceMxn: number | null
  promoterPriceMxn: number | null
  savingsMxn: number | null
  savingsPct: number | null
  /** True when the promoter price resolves to $0 (e.g. the free subdomain year, US-3.2) — display "GRATIS", not "$0". */
  isFree: boolean
}

/** One comparison row for a fixed-price SKU. `regularPriceMxn: null` ⇒ variable price (print_ad). */
export function buildSkuPriceRow(
  sku: PromoterSku,
  regularPriceMxn: number | null,
  skuPrices: PromoterSkuPrices,
  settings: PromoterSettings,
): SkuPriceRow {
  if (regularPriceMxn == null) {
    return { sku, variablePrice: true, regularPriceMxn: null, promoterPriceMxn: null, savingsMxn: null, savingsPct: null, isFree: false }
  }
  const regularCents = Math.round(regularPriceMxn * 100)
  const promoterCents = resolveSkuPromoterPriceCents({ sku, regularPriceCents: regularCents, skuPrices, settings })
  const savingsCents = Math.max(0, regularCents - promoterCents)
  return {
    sku,
    variablePrice: false,
    regularPriceMxn,
    promoterPriceMxn: Math.round(promoterCents / 100),
    savingsMxn: Math.round(savingsCents / 100),
    savingsPct: regularCents > 0 ? Math.round((savingsCents / regularCents) * 100) : 0,
    isFree: promoterCents === 0,
  }
}

/** One row per known SKU (`PROMOTER_SKUS` order) — the full comparison table. */
export function buildSkuPriceTable(
  basePricesMxn: Partial<Record<PromoterSku, number>>,
  skuPrices: PromoterSkuPrices,
  settings: PromoterSettings,
): SkuPriceRow[] {
  return PROMOTER_SKUS.map((sku) => buildSkuPriceRow(sku, basePricesMxn[sku] ?? null, skuPrices, settings))
}

// ── Bundle (the "todo esto cuesta $X — con tu promotor $Y" seam) ──────────────

export interface BundleRow {
  skus: PromoterSku[]
  regularTotalMxn: number
  bundlePriceMxn: number
  savingsMxn: number
  savingsPct: number
  /** What the same SKUs would save bought SEPARATELY at their own promoter prices
   *  (no bundle deal) — the bundle should beat this, but it isn't enforced here;
   *  the caller/admin is responsible for setting a genuinely-bundled price. */
  perItemSavingsSumMxn: number
}

/**
 * Combine the bundled SKUs' rows into one bundle comparison, or `null` when the
 * bundle isn't configured (no price, no SKUs, or none of the bundled SKUs have a
 * fixed price to sum). `bundlePriceMxn` is clamped to [0, regularTotalMxn] so a
 * bad admin value can never show a negative saving or a bundle pricier than list.
 */
export function computeBundleRow(rows: readonly SkuPriceRow[], bundle: BundleConfig): BundleRow | null {
  if (bundle.bundlePriceMxn == null || bundle.skus.length === 0) return null
  const bundled = rows.filter((r) => bundle.skus.includes(r.sku) && !r.variablePrice)
  if (bundled.length === 0) return null

  const regularTotalMxn = bundled.reduce((sum, r) => sum + (r.regularPriceMxn ?? 0), 0)
  const perItemSavingsSumMxn = bundled.reduce((sum, r) => sum + (r.savingsMxn ?? 0), 0)
  const bundlePriceMxn = Math.max(0, Math.min(bundle.bundlePriceMxn, regularTotalMxn))
  const savingsMxn = Math.max(0, regularTotalMxn - bundlePriceMxn)
  const savingsPct = regularTotalMxn > 0 ? Math.round((savingsMxn / regularTotalMxn) * 100) : 0

  return {
    skus: bundled.map((r) => r.sku),
    regularTotalMxn,
    bundlePriceMxn,
    savingsMxn,
    savingsPct,
    perItemSavingsSumMxn,
  }
}
