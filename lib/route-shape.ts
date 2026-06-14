/**
 * lib/route-shape.ts
 *
 * Pure, dependency-free shape predicates for the two dynamic storefront routes
 * `/l/[id]` (a Medusa product id) and `/s/[slug]` (a seller slug). They answer
 * one cheap question — "could this path segment EVER address a real listing /
 * shop?" — WITHOUT any network call, so a clearly-malformed id/slug can 404
 * before we pay a Medusa fetch (epic 09 · vercel-function-cost-reduction S2:
 * scanners hammering dead/junk URLs were the #1 source of `/_not-found`
 * invocations + Fluid Active CPU).
 *
 * Edge-safe (regex only) so `middleware.ts` can use the same predicates it
 * shares with the page guards — one source of truth for the shape rules.
 *
 * IMPORTANT — these gate ONLY obviously-malformed shapes. A well-formed-but-
 * nonexistent id/slug (a *deleted* listing, or a *retired* shop slug that must
 * still 301 via lib/slug-redirect.ts) passes the shape check and flows through
 * to the normal getListing/getShop → notFound()/redirect path unchanged. A
 * retired slug obeys the same format rules as a live one, so rejecting malformed
 * shapes never swallows a redirect.
 */

// Medusa v2 product ids are `prod_` + a 26-char ULID (Crockford base32), e.g.
// `prod_01KTQY8PFAVCRRD61DNSXNXKM8` (total length 31). We accept 20–32 trailing
// alphanumerics for headroom against any future id-length tweak while still
// rejecting every junk segment a scanner sends (`.env`, `wp-login.php`,
// `admin`, `123`, …) — none of which carry the `prod_` prefix.
const LISTING_ID_RE = /^prod_[0-9A-Za-z]{20,32}$/

// Seller slugs: 3–80 lowercase-alphanumeric-and-hyphen chars, no leading or
// trailing hyphen. Same charset rule as the seller-facing validateSlug (lib/slug.ts)
// and the backend guard, but with a GENEROUS length cap: import-generated slugs
// run up to ~53 chars (longer than the user-chosen SLUG_MAX of 40), so the cap
// here is 80 purely to reject pathological/abusive segments — never a real shop.
const SHOP_SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const SHOP_SLUG_MIN = 3
const SHOP_SLUG_MAX = 80

/** True when `id` is shaped like a real Medusa product id (`/l/[id]`). */
export function isLikelyListingId(id: string): boolean {
  return LISTING_ID_RE.test(id)
}

/** True when `slug` is shaped like a real (or retired) seller slug (`/s/[slug]`). */
export function isLikelyShopSlug(slug: string): boolean {
  return slug.length >= SHOP_SLUG_MIN && slug.length <= SHOP_SLUG_MAX && SHOP_SLUG_RE.test(slug)
}
