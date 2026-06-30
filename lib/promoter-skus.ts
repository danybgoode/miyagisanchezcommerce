/**
 * Promoter Program — the commissionable SKU vocabulary, isolated in a tiny
 * dependency-free module so both lib/promoter.ts (DB + discount) and
 * lib/promoter-commission.ts (accrual) import it WITHOUT importing each other
 * (no ESM initialization cycle). Add a new SKU here (e.g. 'subdomain') in one place.
 */

/** The paid SKUs a promoter can enroll a shop on (S1: custom domain; S2: print ad). */
export const PROMOTER_SKUS = ['custom_domain', 'print_ad'] as const
export type PromoterSku = (typeof PROMOTER_SKUS)[number]

export function isPromoterSku(raw: string | null | undefined): raw is PromoterSku {
  return !!raw && (PROMOTER_SKUS as readonly string[]).includes(raw)
}
