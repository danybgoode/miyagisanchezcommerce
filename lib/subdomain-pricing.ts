/**
 * lib/subdomain-pricing.ts
 *
 * Single source of the subdomain SKU price (epic 07 · subdomain-pricing, Sprint 2).
 * Imported by the `/acerca` pricing content, the Canal paywall upsell, and the
 * Stripe plan seed so the number can never drift across surfaces. Mirrors
 * `lib/domain-pricing.ts` for the cheaper subdomain SKU.
 *
 * Pure + next-free → unit-testable by the Playwright `api` runner.
 *
 * The store URL `miyagisanchez.com/s/tu-tienda` stays FREE for everyone forever;
 * the paid SKU is the white-label `tu-tienda.miyagisanchez.com` subdomain. Existing
 * shops are grandfathered free (silent; not surfaced in public pricing copy).
 */

export const SUBDOMAIN_PRICE_YEARLY_CENTS = 19900
export const SUBDOMAIN_PRICE_YEARLY_MXN = 199
/** The standalone monthly cadence ($25/mo) — Sprint 3. Yearly stays the discounted
 *  option ($199/yr ≈ $17/mo); monthly is the no-annual-commitment entry. */
export const SUBDOMAIN_PRICE_MONTHLY_MXN = 25
export const SUBDOMAIN_PRICE_MONTHLY_CENTS = 2500
export const SUBDOMAIN_CURRENCY = 'MXN'

/** Display label used on the bilingual `/acerca` pricing section + the es-MX upsell. */
export const SUBDOMAIN_PRICE_LABEL: { es: string; en: string } = {
  es: '$199 MXN/año (~$17/mes)',
  en: '$199 MXN/year (~$17/mo)',
}

/** Monthly cadence label (Sprint 3) — shown alongside the yearly one so the yearly
 *  option reads as the discount. Single source for the pricing copy + agent tools. */
export const SUBDOMAIN_PRICE_MONTHLY_LABEL: { es: string; en: string } = {
  es: '$25 MXN/mes',
  en: '$25 MXN/mo',
}
