/**
 * lib/claim.ts
 *
 * The single source of truth for "is this shop claimed by a real seller?".
 *
 * A gem-imported shop is created with no owner: `clerk_user_id` is `null` (or a
 * legacy `pending:<token>` placeholder from older claim flows). Such shops are
 * **contact-only** — buyers must reach out directly; no Buy / Make-offer /
 * Add-to-cart / Bundle / online checkout should be offered, because nothing on
 * the other side can receive it.
 *
 * This predicate was duplicated inline at the checkout-session route; it is now
 * extracted here so the PDP, the offers route, and checkout-session all agree.
 * Dependency-free (no `next/*`) so the Playwright `api` runner can unit-test it.
 */

export type ClaimableShop = { clerk_user_id?: string | null } | null | undefined

/**
 * True only when the shop has a genuine owner: a non-empty `clerk_user_id` that
 * is not the legacy `pending:` placeholder. `null`/`undefined`/`pending:*` → false.
 */
export function isShopClaimed(shop: ClaimableShop): boolean {
  const ownerId = shop?.clerk_user_id
  return !!(ownerId && !ownerId.startsWith('pending:'))
}
