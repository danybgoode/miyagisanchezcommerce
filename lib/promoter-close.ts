/**
 * Promoter Program — Sprint 4 "in-person close" pure helpers.
 *
 * Next-free + dependency-free (no supabase, no `next/*`, no `server-only`) so the
 * WhatsApp-link builder, the synthetic provenance URL, and the paid-by-promoter
 * provenance marker are directly unit-testable (e2e/promoter-close.spec.ts) —
 * same discipline as lib/promoter.ts. The DB / Stripe / Medusa side lives in the
 * route handlers that import these.
 */

import { normalizePromoterCode } from '@/lib/promoter'

/**
 * Stripe Checkout metadata values must be strings — the marker that distinguishes
 * a promoter paying on a seller's behalf from an ordinary seller-self checkout.
 */
export const PAID_BY_PROMOTER_FLAG = '1'

/** The note stamped on the one-time domain grant, so the provenance is auditable
 *  on the shop's metadata (vs the S2 seller-self note). */
export function oneTimeGrantNote(paidByPromoter: boolean): string {
  return paidByPromoter ? 'one-time S4 paid-by-promoter' : 'one-time S2'
}

/**
 * A stable synthetic `source_url` for a promoter-minted unclaimed seller, so the
 * backend `/internal/sellers` mint stays idempotent (re-running setup for the same
 * promoter + shop name returns the existing seller instead of duplicating). Mirrors
 * the `source_url` provenance the supply/gem importer relies on, in a distinct
 * `promoter://` namespace so the two pipelines never collide.
 */
export function promoterSourceUrl(promoterCode: string, shopName: string): string {
  const code = normalizePromoterCode(promoterCode)
  const slug = (shopName ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `promoter://${code}/${slug || 'tienda'}`
}

/**
 * Build a one-tap WhatsApp share link that carries the claim URL + a short es-MX
 * pitch. `https://wa.me/?text=…` opens WhatsApp's share sheet (the promoter picks
 * the merchant's chat) — no phone number required. The claim URL itself is the
 * 24h-expiry signed token from lib/claimJwt (signed by the caller, passed in).
 */
export function buildWhatsAppClaimLink(input: { claimUrl: string; shopName: string }): string {
  const { claimUrl, shopName } = input
  const name = (shopName ?? '').trim() || 'tu tienda'
  const message =
    `¡Hola! Ya dejé lista *${name}* en miyagisanchez.com. ` +
    `Toca este enlace para reclamarla y administrarla tú (vence en 24 h):\n${claimUrl}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
