/**
 * lib/ml-sync-pricing.ts
 *
 * Single source of the ML-sync SKU price (epic 03 · mercadolibre-sync, Sprint 6).
 * Imported by the `/shop/manage/mercadolibre` upsell, the checkout builder, and the
 * Stripe plan seed so the number can never drift across surfaces. Mirrors
 * `lib/subdomain-pricing.ts`.
 *
 * Pure + next-free → unit-testable by the Playwright `api` runner.
 *
 * ML inventory sync (two-way stock between Mercado Libre and Miyagi) is the paid
 * feature; connecting / importing / publishing stay free. Yearly is the discounted
 * option; monthly is the no-annual-commitment entry.
 */

export const ML_SYNC_PRICE_YEARLY_CENTS = 29900
export const ML_SYNC_PRICE_YEARLY_MXN = 299
export const ML_SYNC_PRICE_MONTHLY_MXN = 30
export const ML_SYNC_PRICE_MONTHLY_CENTS = 3000
export const ML_SYNC_CURRENCY = 'MXN'

/** es-MX display labels (single source for the upsell copy + agent tools). */
export const ML_SYNC_PRICE_LABEL = '$299 MXN/año (~$25/mes)'
export const ML_SYNC_PRICE_MONTHLY_LABEL = '$30 MXN/mes'
