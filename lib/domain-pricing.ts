/**
 * lib/domain-pricing.ts
 *
 * Single source of the custom-domain SKU price (epic 07 · custom-domain-paywall,
 * Sprint 2). Imported by the `/acerca` pricing content, the Canal paywall upsell,
 * and the Stripe plan seed so the number can never drift across surfaces.
 *
 * Pure + next-free → unit-testable by the Playwright `api` runner.
 * Subdomain stays FREE for everyone; only the custom domain is the paid SKU.
 */

export const CUSTOM_DOMAIN_PRICE_CENTS = 49900
export const CUSTOM_DOMAIN_PRICE_MXN = 499
export const CUSTOM_DOMAIN_PRICE_MONTHLY_MXN = 42
export const CUSTOM_DOMAIN_CURRENCY = 'MXN'

/** Display label used on the bilingual `/acerca` pricing section + the es-MX upsell. */
export const CUSTOM_DOMAIN_PRICE_LABEL: { es: string; en: string } = {
  es: '$499 MXN/año (~$42/mes)',
  en: '$499 MXN/year (~$42/mo)',
}
