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
/** The standalone monthly cadence ships in Sprint 3 — the constant lives here now
 *  so the price has a single home; no $25/mo checkout exists yet. */
export const SUBDOMAIN_PRICE_MONTHLY_MXN = 25
export const SUBDOMAIN_CURRENCY = 'MXN'

/** Display label used on the bilingual `/acerca` pricing section + the es-MX upsell. */
export const SUBDOMAIN_PRICE_LABEL: { es: string; en: string } = {
  es: '$199 MXN/año (~$17/mes)',
  en: '$199 MXN/year (~$17/mo)',
}
