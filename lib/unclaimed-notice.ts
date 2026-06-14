/**
 * lib/unclaimed-notice.ts
 *
 * PDP redesign (epic 01) — Sprint 5, S5.4 (unclaimed / imported listings).
 *
 * Pure, next-free seam for the honest "aún no reclamada" notice. A gem-imported
 * shop has no owner (`isShopClaimed(shop) === false`), so Buy / Offer / Cart are
 * already suppressed upstream (`showBuyerActions = isClaimed && !isOwn`) and the
 * SellerTrustCard already surfaces contact options + the claim nudge. This module
 * only owns the notice copy + the claim href so the PDP can lead with an honest
 * status instead of looking like a broken store. **No gating change** — the
 * suppression stays where it is (`isShopClaimed`).
 *
 * "Claim awakens the PDP": once the owner claims the shop (the existing gem-claim
 * loop sets a real `clerk_user_id`), `isShopClaimed` flips true and the same PDP
 * skeleton shows price / Buy / Offer / methods / protección (§02) — no new code.
 *
 * No JSX / no network → unit-tested in the `api` gate (`e2e/unclaimed-notice.spec.ts`).
 */

export interface UnclaimedNoticeModel {
  title: string
  body: string
  /** Claim flow for this shop (matches SellerTrustCard's nudge href). */
  claimHref: string
  claimLabel: string
}

export function unclaimedNoticeModel(shopSlug: string): UnclaimedNoticeModel {
  return {
    title: 'Tienda aún no reclamada',
    body: 'Este anuncio se importó y la tienda todavía no tiene dueño en Miyagi Sánchez. Puedes contactar directamente para preguntar por el artículo. La compra protegida y las ofertas en línea se activan cuando el dueño reclame la tienda.',
    claimHref: `/s/${shopSlug}/claim`,
    claimLabel: '¿Es tuya esta tienda? Reclama gratis',
  }
}
