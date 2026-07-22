/**
 * lib/preview-privacy-decision.ts
 *
 * The PURE fail-closed privacy decision for founding-merchant consent previews.
 * Zero app imports (no `server-only`, no Supabase) so the security-critical rule
 * is directly unit-testable — `lib/preview-access.ts` feeds it the facts it reads
 * from the DB. Extracted so the spec exercises the REAL decision, not a shim
 * (cross-agent review, 2026-07-21).
 *
 * The rule (Daniel 2026-07-21): fail CLOSED, scoped to the draft/unclaimed
 * population. Privacy and tenant-boundary protection beat availability for the
 * states that can actually be private — but a CLAIMED shop is decided without any
 * read, so a DB blip can never hide a live storefront.
 */

/** What the anchor read found for a shop. `error` = the READ itself failed. */
export type AnchorState = 'none' | 'held' | 'activated' | 'error'

/** What the claimed-status read found. `unknown` = the read failed. */
export type ClaimState = 'claimed' | 'unclaimed' | 'unknown'

/**
 * Is a shop preview-private (must be hidden / must not receive a published write)?
 *
 *  - `claimed`   → never private (a merchant owns it). Decided FIRST, before any
 *                  other fact, because the caller knows it without a Supabase read.
 *  - `unknown`   → the claim read failed → fail CLOSED (private). Only reached for
 *                  a shop already known to be in the unclaimed/anchored population.
 *  - anchor `error` → fail CLOSED (private): a read we can't trust is treated as
 *                  private rather than mistaken for "no anchor".
 *  - anchor `none` / `activated` → not private.
 *  - anchor `held` (a non-activated anchor) + unclaimed → private.
 */
export function decidePreviewPrivacy(input: { claim: ClaimState; anchor: AnchorState }): boolean {
  if (input.claim === 'claimed') return false
  if (input.anchor === 'error') return true
  if (input.claim === 'unknown') return true
  return input.anchor === 'held'
}

/**
 * Is `id` a mirror-shop UUID (`marketplace_shops.id`, which `merchant_previews.
 * shop_id` keys on) — as opposed to a Medusa seller id (`sel_…`) or anything else?
 *
 * The consent tables key exclusively on the mirror UUID. Feeding a non-UUID (a
 * `getShop` object's `.id` is the SELLER id) into that UUID column throws Postgres
 * `22P02`, which the fail-closed guards turn into a 404. This predicate is the gate
 * that keeps a non-mirror id from ever reaching the query: only a canonical v4-shape
 * UUID string is trusted as a mirror id; everything else resolves from the slug.
 */
export function isMirrorShopId(id: string | null | undefined): id is string {
  return typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}
