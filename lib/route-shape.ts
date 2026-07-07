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

// Collection short slugs (`/c/[collection]`, own-shop-premium-presentation S2):
// the seller-namespace prefix is already stripped before this segment reaches
// a URL (see lib/collection-derive.ts's shortCollectionSlug), so the shape
// rule is the same charset as a shop slug but shorter — a collection name is
// capped at 60 chars server-side (seller-collections.ts), well under 80.
const COLLECTION_SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const COLLECTION_SLUG_MIN = 1
const COLLECTION_SLUG_MAX = 60

/** True when `id` is shaped like a real Medusa product id (`/l/[id]`). */
export function isLikelyListingId(id: string): boolean {
  return LISTING_ID_RE.test(id)
}

/** True when `slug` is shaped like a real (or retired) seller slug (`/s/[slug]`). */
export function isLikelyShopSlug(slug: string): boolean {
  return slug.length >= SHOP_SLUG_MIN && slug.length <= SHOP_SLUG_MAX && SHOP_SLUG_RE.test(slug)
}

/** True when `slug` is shaped like a real collection short slug (`/c/[collection]`). */
export function isLikelyCollectionSlug(slug: string): boolean {
  return slug.length >= COLLECTION_SLUG_MIN && slug.length <= COLLECTION_SLUG_MAX && COLLECTION_SLUG_RE.test(slug)
}

/**
 * Boundary-isolation deny-list — a subdomain/custom-domain channel serves
 * ONLY its own shop, so these paths (which would expose the platform slug or
 * browse across shops) get redirected home by `middleware.ts` in BOTH the
 * subdomain and custom-domain branches. Extracted as one pure predicate so
 * both call sites AND this rule's regression spec
 * (`e2e/collection-route-passthrough.spec.ts`) share a single source of
 * truth — a future edit can't silently start blocking `/c/[collection]`
 * (own-shop-premium-presentation S2) without the shared function changing.
 */
export function isBoundaryDeniedPath(path: string): boolean {
  return path === '/s' || path.startsWith('/s/') || path === '/l' || path === '/l/'
}
