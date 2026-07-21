/**
 * lib/preview-access.ts
 *
 * Founding merchant consent-safe previews (epic 08) — the non-commerce consent
 * lifecycle + opaque preview-link grants layered over Medusa draft products.
 *
 * A "preview" is one anchor row per shop (`merchant_previews`) that tracks the
 * consent lifecycle (draft → delivered → approved → activated, …). Its products
 * are native Medusa `status:'draft'` products, already excluded from every public
 * /store/* read seam — so PRIVACY is structural, enforced at the backend query
 * layer, not re-implemented here. This module only records WHO may privately
 * review (opaque grants) and, in later sprints, WHETHER it was approved.
 *
 * Token discipline mirrors lib/agent-auth.ts exactly: a high-entropy opaque token
 * (`mp_<hex>`) is shown to the promoter once; only its SHA-256 hash is stored.
 * Resolution is a constant-time indexed hash lookup (the token is 256 bits of
 * entropy — enumeration is infeasible, so no per-request timingSafeEqual needed).
 * Revocation is a timestamp, never a delete — the resolver treats a revoked or
 * expired grant as absent (→ the caller returns a plain 404).
 *
 * Runtime: Node only (Supabase service-role client). Never import from Edge.
 */
import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { listShopDraftsViaInternal } from '@/lib/seller-products'
import { decidePreviewPrivacy, type AnchorState, type ClaimState } from '@/lib/preview-privacy-decision'
export { canAnchorPreview } from '@/lib/promoter-close'
import {
  generatePreviewToken,
  hashPreviewToken,
  isWellFormedPreviewToken,
} from '@/lib/preview-token'

export { PREVIEW_TOKEN_PREFIX, generatePreviewToken, hashPreviewToken } from '@/lib/preview-token'

/** Lifecycle status of a shop's preview anchor. */
export type PreviewStatus =
  | 'draft'
  | 'delivered'
  | 'changes_requested'
  | 'approved'
  | 'invalidated'
  | 'activated'

export interface MerchantPreview {
  id: string
  shopId: string
  status: PreviewStatus
  currentVersion: number
  createdBy: string
}

function rowToPreview(row: {
  id: string
  shop_id: string
  status: string
  current_version: number
  created_by: string
}): MerchantPreview {
  return {
    id: row.id,
    shopId: row.shop_id,
    status: row.status as PreviewStatus,
    currentVersion: row.current_version,
    createdBy: row.created_by,
  }
}


/**
 * Ensure a shop has a preview anchor, returning it. Idempotent: one row per shop
 * (unique index). Never resurrects an already-activated preview back to draft —
 * an activated shop is public and out of the consent flow.
 *
 * AUTHORIZATION IS THE CALLER'S JOB — every caller must pass `canAnchorPreview`
 * first (see its doc for why both conditions matter).
 */
export async function ensureShopPreview(
  shopId: string,
  createdBy: string,
): Promise<MerchantPreview | null> {
  const existing = await getPreviewByShop(shopId)
  if (existing) return existing

  const { data, error } = await db
    .from('merchant_previews')
    .insert({ shop_id: shopId, status: 'draft', created_by: createdBy })
    .select('id, shop_id, status, current_version, created_by')
    .single()

  // A concurrent insert can lose the unique-index race — re-read rather than fail.
  if (error || !data) return getPreviewByShop(shopId)
  return rowToPreview(data)
}

/**
 * Read a shop's preview anchor. Returns `{ preview: null }` when the shop has no
 * anchor, and `{ error: true }` when the READ ITSELF failed — the two are
 * DISTINCT so callers can fail closed on an error rather than treating a DB blip
 * as "no anchor" (the whole point of the fail-closed posture, Daniel 2026-07-21).
 */
export async function readPreviewByShop(
  shopId: string,
): Promise<{ preview: MerchantPreview | null; error: boolean }> {
  const { data, error } = await db
    .from('merchant_previews')
    .select('id, shop_id, status, current_version, created_by')
    .eq('shop_id', shopId)
    .maybeSingle()
  if (error) return { preview: null, error: true }
  return { preview: data ? rowToPreview(data) : null, error: false }
}

/** Back-compat convenience: the anchor or null (an error also reads as null here). */
export async function getPreviewByShop(shopId: string): Promise<MerchantPreview | null> {
  const { preview } = await readPreviewByShop(shopId)
  return preview
}

/**
 * The public shop-shell leak guard, as one call: 404 if this shop is
 * preview-private. Applied at EVERY public shop-shell entry point — the shop home,
 * its content pages (`/acerca`, `/faq`, `/politicas`), collections, the claim page,
 * `/convocatoria`, and the embed widget.
 *
 * Takes the SHOP OBJECT (which every call site already loaded via `getShop`), not
 * just a slug, so a CLAIMED shop is decided from data in hand with ZERO Supabase
 * reads — see `isShopPreviewPrivateForShop` for why that matters to the
 * fail-closed posture.
 *
 * Deliberately NOT folded into `getShop()`: that helper is `unstable_cache`d with
 * the `shops` tag, so the privacy decision would be memoized and outlive a
 * revocation or activation.
 */
export async function assertShopNotPreviewPrivate(
  shop: { slug: string; clerk_user_id: string | null },
): Promise<void> {
  if (await isShopPreviewPrivateForShop(shop)) notFound()
}

/**
 * True when this single shop is preview-private: it has a non-activated anchor
 * AND it is still unclaimed. Read path — used by the public render guards.
 *
 * FAIL-CLOSED, scoped to the draft/unclaimed population (Daniel 2026-07-21):
 * privacy and tenant-boundary protection take priority over availability for the
 * states that can actually be private. The scoping is what keeps that from 404-ing
 * the whole marketplace on a Supabase blip:
 *
 *  - A CLAIMED shop is never private. That is decided from `clerk_user_id`, which
 *    the caller already holds on the Medusa shop object — so a claimed/live shop
 *    reaches ZERO Supabase reads here and a Supabase outage cannot hide it.
 *  - An UNCLAIMED shop consults the anchor. If that read ERRORS we cannot prove
 *    the shop is safe to show, so we fail CLOSED (treat as private). This only
 *    ever hides unclaimed shops — a small population where a brief blip-hide is
 *    acceptable and a leak is not.
 *
 * The CLAIMED escape is also load-bearing for correctness, not just the blip
 * case: `canAnchorPreview` checks `clerk_user_id` only at anchor time, and
 * `/api/claim/complete` flips it without touching this table (there is no UPDATE
 * or DELETE of `merchant_previews` anywhere). Without this, the epic's own happy
 * path — promoter anchors an unclaimed shop → merchant claims it — would 404 the
 * merchant's storefront forever. Clearing the anchor on claim publishes NOTHING
 * (products stay Medusa drafts; only the merchant can publish them), so this does
 * not treat a claim as publication approval (locked decision #3).
 */
export async function isShopPreviewPrivateForShop(
  shop: { id?: string | null; slug: string; clerk_user_id: string | null },
): Promise<boolean> {
  // Claimed → never private, and NO Supabase read, so a live shop is immune to a
  // Supabase blip.
  if (shop.clerk_user_id) return false

  // Unclaimed → resolve the mirror id if we weren't given it.
  let shopId = shop.id ?? null
  if (!shopId) {
    const clean = (shop.slug ?? '').trim()
    if (!clean) return false // no way to identify → nothing to hide
    const { data, error } = await db
      .from('marketplace_shops')
      .select('id')
      .eq('slug', clean)
      .maybeSingle()
    // Fail CLOSED: an unclaimed shop we can't resolve is treated as private.
    if (error) return true
    if (!data?.id) return false // genuinely absent → not in the preview population
    shopId = data.id as string
  }

  return isShopPreviewPrivate(shopId)
}

/**
 * By-id privacy decision — the WRITE-path entry point (`shopMustStayPrivate`) and
 * the resolved tail of the read path. FAIL-CLOSED on the anchor read error: a
 * shop we can't verify is treated as private, so a write can't publish into a
 * maybe-private shop and a render can't reveal one.
 *
 * Still honors the CLAIMED escape by id (the write paths pass only a shop id):
 * an already-claimed shop is never private. That read failing is itself failed
 * closed — an unclaimed-or-unknown shop is treated as private.
 */
export async function isShopPreviewPrivate(shopId: string): Promise<boolean> {
  const { preview, error } = await readPreviewByShop(shopId)
  const anchor: AnchorState = error
    ? 'error'
    : preview === null
      ? 'none'
      : preview.status === 'activated'
        ? 'activated'
        : 'held'

  // Short-circuit: only a 'held' anchor can make a shop private, so skip the
  // claim read entirely otherwise (and never fail-closed a shop that has no
  // anchor just because its claim read would have blipped).
  if (anchor !== 'held') return decidePreviewPrivacy({ claim: 'unclaimed', anchor })

  const { data: shop, error: shopError } = await db
    .from('marketplace_shops')
    .select('clerk_user_id')
    .eq('id', shopId)
    .maybeSingle()
  const claim: ClaimState = shopError ? 'unknown' : shop?.clerk_user_id ? 'claimed' : 'unclaimed'
  return decidePreviewPrivacy({ claim, anchor })
}

/**
 * Must anything written into this shop stay PRIVATE? The anchor — not the feature
 * flag, and not who is calling — is authoritative for that question.
 *
 * Two holes this closes, both found by the round-3 cross-agent pass:
 *  1. **Flag-store outage.** `promoter.private_preview_enabled` is an enablement
 *     flag, so an unreadable flag store falls open to `false`. For creating NEW
 *     previews that is right (it is exactly today's pre-epic behavior). But for a
 *     shop that ALREADY has an unapproved anchor, falling back to force-publish
 *     would publish a merchant's products during a transient flag outage —
 *     consent the merchant never gave. The anchor is durable state; the flag is
 *     not. Once the anchor exists, it wins.
 *  2. **A different promoter.** `canAnchorPreview` is false for a promoter acting
 *     on someone else's shop — correct for ANCHORING, but it must not mean
 *     "publish freely into it". A shop awaiting its merchant's consent must
 *     refuse publication from anyone.
 *
 * Fails OPEN (false) only when there is genuinely no anchor to find; a read error
 * is indistinguishable from that here, which is why callers that can afford to
 * fail closed (the write paths) should prefer this over inferring from the flag.
 */
export async function shopMustStayPrivate(shopId: string): Promise<boolean> {
  return isShopPreviewPrivate(shopId)
}

/**
 * Is this shop ALREADY publicly trading? A shop with live (`active`) listings has
 * a public presence people may already be linking to and buying from — anchoring
 * it would hide a working storefront, which is precisely what locked decision #4
 * forbids ("existing public/unclaimed shops are audited, not bulk-mutated;
 * historical disposition remains manual"). The entire pre-epic promoter-close
 * install base has this shape, so without the check, adding one listing to any of
 * those shops would take it down.
 *
 * Fails SAFE (true ⇒ "don't anchor") on a read error: refusing to make a new
 * preview is recoverable; hiding a live shop is not.
 */
export async function shopHasPublicListings(shopId: string): Promise<boolean> {
  const { data, error } = await db
    .from('marketplace_listings')
    .select('id')
    .eq('shop_id', shopId)
    .eq('status', 'active')
    .limit(1)
  if (error) return true
  return (data ?? []).length > 0
}

/**
 * True when the shop at this slug is preview-private — the public shop-shell leak
 * guard (`/s/[slug]`, and via rewrite its custom-domain + subdomain channels).
 * Resolves the marketplace_shops UUID from the slug (the public shop object carries
 * the Medusa seller id, not the mirror id previews key off).
 *
 * Deliberately NOT gated on `promoter.private_preview_enabled`. An earlier round
 * gated it so that flipping the flag OFF would un-hide anchored shops — but that
 * makes privacy fail-OPEN: a flag flip (or an unreadable flag store) would publish
 * a shop whose merchant never approved being presented, and the epic's locked
 * decision #3 is that nothing short of explicit approval is consent. A flag flip
 * is not consent. The flag's job is to stop NEW previews being created, not to
 * publish existing unapproved ones.
 *
 * That gate was only ever a mitigation for the storefront-takedown vector, and
 * `canAnchorPreview` blocks anchoring a claimed shop, and `isShopPreviewPrivate`
 * additionally stops honoring an anchor once a shop BECOMES claimed — the two
 * together, not the anchor-time check alone, are what keep a live merchant's
 * storefront reachable. (An earlier revision of this comment claimed the
 * anchor-time check made takedown "impossible by construction"; that was an
 * overclaim — it checks `clerk_user_id` only at anchor time, and claiming happens
 * afterwards on this epic's own happy path.) Un-hiding a shop that is still
 * unclaimed remains a deliberate act: activate the approved snapshot (S2.3), or
 * delete the anchor row.
 *
 * FAIL-CLOSED, scoped to the unclaimed population (Daniel 2026-07-21): a claimed
 * shop short-circuits to visible with no Supabase read, so a blip can't 404 a
 * live shop; an unclaimed shop whose anchor read errors is treated as private.
 * See `isShopPreviewPrivateForShop` for the full rationale — this is a thin
 * cached wrapper over it for the call sites that hold a `Shop`-shaped object.
 *
 * Wrapped in React `cache()` for per-REQUEST memoization: a channel-host request
 * hits this twice (the `(shell)` layout chrome and the page inside), and that
 * layout runs on every white-label request from a paying tenant's domain. Request
 * scope only — no cross-request staleness, so a revocation or activation still
 * takes effect on the very next request. Keyed on the slug (the memo cache needs a
 * primitive key), so all callers for one shop in a request must pass a consistent
 * `clerk_user_id` — which they do, all reading the same `getShop` result.
 */
export const isShopPreviewPrivateBySlug = cache(
  async (slug: string, clerkUserId: string | null): Promise<boolean> => {
    return isShopPreviewPrivateForShop({ slug, clerk_user_id: clerkUserId })
  },
)

export interface PreviewProduct {
  id: string
  title: string
  priceCents: number | null
  currency: string
  imageUrl: string | null
}

export interface PreviewPresentation {
  shopName: string
  shopSlug: string
  status: PreviewStatus
  products: PreviewProduct[]
}

/**
 * The proposed shop presentation a preview link renders.
 *
 * PRODUCTS are read from MEDUSA (authoritative), via the backend internal route
 * `GET /internal/seller-products/drafts` — the Sprint-1 review decision (Daniel,
 * 2026-07-21): the consent surface must show exactly what activation will publish,
 * so it reads the commerce source of truth, not the Supabase mirror that can drift
 * from it. The route returns the same `toListingShape` the published catalog uses.
 *
 * SHOP IDENTITY (name, slug) is non-commerce and stays on `marketplace_shops` —
 * Medusa's seller carries the name too, but the mirror is this epic's own
 * identity/consent home and the id we key on is the mirror id.
 *
 * FAIL-CLOSED: returns null if the shop row is gone OR the Medusa draft read fails
 * for any reason. A consent surface must never render a partial/empty proposal a
 * merchant might approve, so the caller 404s rather than showing an empty shop.
 *
 * Exposes no admin/promoter controls, ownership, or checkout.
 */
export async function getPreviewPresentation(
  preview: MerchantPreview,
): Promise<PreviewPresentation | null> {
  const { data: shop, error: shopError } = await db
    .from('marketplace_shops')
    .select('name, slug')
    .eq('id', preview.shopId)
    .maybeSingle()
  if (shopError || !shop) return null

  // Medusa-authoritative draft read. null ⇒ the read failed (secret/network/non-
  // 200) — fail closed, never a silently-empty proposal.
  const drafts = await listShopDraftsViaInternal(String(shop.slug ?? ''))
  if (drafts === null) return null

  const products: PreviewProduct[] = drafts.map((d) => ({
    id: d.id,
    title: d.title,
    priceCents: d.price_cents,
    currency: d.currency,
    imageUrl: d.image_url,
  }))

  return {
    shopName: String(shop.name ?? ''),
    shopSlug: String(shop.slug ?? ''),
    status: preview.status,
    products,
  }
}

/**
 * Mint a new opaque preview-link grant for a preview. Returns the plaintext token
 * (shown once) — only its hash is stored. `ttlDays` bounds the link's life; omit
 * for no expiry.
 */
export async function mintPreviewGrant(
  previewId: string,
  createdBy: string,
  ttlDays?: number,
): Promise<{ token: string } | null> {
  const { token, hash } = generatePreviewToken()
  const expiresAt =
    typeof ttlDays === 'number' && ttlDays > 0
      ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : null
  const { error } = await db.from('merchant_preview_grants').insert({
    preview_id: previewId,
    token_hash: hash,
    created_by: createdBy,
    expires_at: expiresAt,
  })
  if (error) return null
  return { token }
}

/**
 * Resolve a plaintext preview token to its preview anchor, honoring revocation and
 * expiry. Returns null for an unknown / revoked / expired token — the caller maps
 * that to a plain 404 (never leak which of the three it was). Never throws.
 */
export async function resolvePreviewByToken(token: string): Promise<MerchantPreview | null> {
  if (!isWellFormedPreviewToken(token)) return null
  const hash = hashPreviewToken(token)
  const { data, error } = await db
    .from('merchant_preview_grants')
    .select('preview_id, revoked_at, expires_at')
    .eq('token_hash', hash)
    .maybeSingle()
  if (error || !data) return null
  if (data.revoked_at) return null
  if (data.expires_at && new Date(data.expires_at as string).getTime() <= Date.now()) return null

  const { data: preview } = await db
    .from('merchant_previews')
    .select('id, shop_id, status, current_version, created_by')
    .eq('id', data.preview_id as string)
    .maybeSingle()
  if (!preview) return null
  const resolved = rowToPreview(preview)
  // An ACTIVATED preview is public — the private link has served its purpose and
  // must stop resolving, independently of whether activation managed to revoke
  // every outstanding grant. Callers 404, and the merchant simply visits the now
  // public shop instead.
  if (resolved.status === 'activated') return null
  return resolved
}

/**
 * Revoke every active grant for a preview (the "revoke the link" action). Idempotent.
 *
 * Returns `null` on a database failure — deliberately DISTINCT from `0` ("there was
 * nothing left to revoke"). Collapsing the two would let the route report a
 * successful revocation while the supposedly-dead URL still resolves, which on a
 * consent surface is the worst possible lie. The caller surfaces the failure.
 */
export async function revokePreviewGrants(previewId: string): Promise<number | null> {
  const { data, error } = await db
    .from('merchant_preview_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('preview_id', previewId)
    .is('revoked_at', null)
    .select('id')
  if (error || !data) return null
  return data.length
}
