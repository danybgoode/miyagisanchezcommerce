/**
 * Promoter Program · promoter-funnel-v2 S1 — the landing's earnings/price seam.
 *
 * Turns the existing admin config (per-SKU commission rate + the seller-discount
 * settings — both already read by /admin/promoter) into the numbers the public
 * landing shows: regular vs. promoter price per SKU, the commission a promoter
 * earns per close, and a "close N shops/month" example. Pure + next-free, mirroring
 * lib/promoter-commission.ts — the caller (the promotor page) fetches the config,
 * this module only computes.
 *
 * `print_ad` has no fixed price (admin-configured per-tier, variable by edition —
 * see lib/print-server.ts), so it's intentionally absent from
 * PROMOTER_SKU_BASE_PRICE_MXN; every computation here degrades it to a
 * commission-%-only row instead of inventing a number.
 */

import { computePromoterDiscountCents, type PromoterSettings } from '@/lib/promoter'
import { PROMOTER_SKUS, type PromoterSku } from '@/lib/promoter-skus'
import { CUSTOM_DOMAIN_PRICE_MXN } from '@/lib/domain-pricing'
import { SUBDOMAIN_PRICE_YEARLY_MXN } from '@/lib/subdomain-pricing'
import { ML_SYNC_PRICE_YEARLY_MXN } from '@/lib/ml-sync-pricing'

/** Single source of the fixed per-SKU price the earnings table starts from. */
export const PROMOTER_SKU_BASE_PRICE_MXN: Partial<Record<PromoterSku, number>> = {
  custom_domain: CUSTOM_DOMAIN_PRICE_MXN,
  subdomain: SUBDOMAIN_PRICE_YEARLY_MXN,
  ml_sync: ML_SYNC_PRICE_YEARLY_MXN,
}

/** The representative SKU for the "close N shops/month" example (the primary close per the glossary/steps copy). */
const EXAMPLE_SKU: PromoterSku = 'custom_domain'

export type PromoterSkuEarnings =
  | { sku: PromoterSku; variablePrice: false; regularPriceMxn: number; promoterPriceMxn: number; commissionMxn: number | null }
  | { sku: PromoterSku; variablePrice: true; commissionPct: number | null }

/**
 * Regular vs. promoter-discounted price + the promoter's commission for one priced
 * SKU. `commissionMxn` degrades to `null` (never `$0`) when the admin hasn't
 * configured a rate for this SKU yet.
 */
export function computePromoterSkuEarnings(
  basePriceMxn: number,
  ratePct: number,
  settings: PromoterSettings,
): { regularPriceMxn: number; promoterPriceMxn: number; commissionMxn: number | null } {
  const baseCents = Math.round(basePriceMxn * 100)
  const discountCents = computePromoterDiscountCents(settings.discount_type, settings.discount_amount_cents, baseCents)
  const promoterPriceMxn = Math.max(0, Math.round((baseCents - discountCents) / 100))
  const commissionMxn = ratePct > 0 ? Math.round((baseCents * ratePct) / 100 / 100) : null
  return { regularPriceMxn: basePriceMxn, promoterPriceMxn, commissionMxn }
}

/** One row per PROMOTER_SKUS entry; print_ad carries `variablePrice: true` (no fixed mxn). */
export function buildPromoterEarningsTable(
  rates: Record<PromoterSku, number>,
  settings: PromoterSettings,
): PromoterSkuEarnings[] {
  return PROMOTER_SKUS.map((sku): PromoterSkuEarnings => {
    const basePriceMxn = PROMOTER_SKU_BASE_PRICE_MXN[sku]
    const ratePct = rates[sku] ?? 0
    if (basePriceMxn == null) {
      return { sku, variablePrice: true, commissionPct: ratePct > 0 ? ratePct : null }
    }
    return { sku, variablePrice: false, ...computePromoterSkuEarnings(basePriceMxn, ratePct, settings) }
  })
}

/**
 * The hero's single headline commission figure — the max configured rate across
 * all SKUs, as `"{n}%"`. `null` when nothing is configured yet, so the caller can
 * degrade the hero stat instead of rendering a `0%`/placeholder.
 */
export function promoterHeroCommissionStat(rates: Record<PromoterSku, number>): string | null {
  const maxRate = Math.max(0, ...PROMOTER_SKUS.map((sku) => rates[sku] ?? 0))
  return maxRate > 0 ? `${maxRate}%` : null
}

export type PromoterEarningsExample = { closesPerMonth: number; estimatedMonthlyMxn: number }

/**
 * "If you close N shops/month, you'd earn ~$X" — off the representative SKU
 * (custom_domain). `null` when that SKU's rate isn't configured yet (nothing to
 * project), rather than showing a `$0` example.
 */
export function buildPromoterEarningsExample(
  rates: Record<PromoterSku, number>,
  settings: PromoterSettings,
  closesPerMonth: number[],
): PromoterEarningsExample[] | null {
  const basePriceMxn = PROMOTER_SKU_BASE_PRICE_MXN[EXAMPLE_SKU]
  if (basePriceMxn == null) return null
  const ratePct = rates[EXAMPLE_SKU] ?? 0
  const { commissionMxn } = computePromoterSkuEarnings(basePriceMxn, ratePct, settings)
  if (commissionMxn == null) return null
  return closesPerMonth.map((n) => ({ closesPerMonth: n, estimatedMonthlyMxn: Math.round(commissionMxn * n) }))
}
