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
import { notFound } from 'next/navigation'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
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

/** Read a shop's preview anchor, or null if the shop has none. */
export async function getPreviewByShop(shopId: string): Promise<MerchantPreview | null> {
  const { data } = await db
    .from('merchant_previews')
    .select('id, shop_id, status, current_version, created_by')
    .eq('shop_id', shopId)
    .maybeSingle()
  return data ? rowToPreview(data) : null
}

/**
 * The public shop-shell leak guard, as one call: 404 if this slug's shop is
 * preview-private. Applied at EVERY public shop-shell entry point — the shop home,
 * its content pages (`/acerca`, `/faq`, `/politicas`), collections, the claim page,
 * `/convocatoria`, and the embed widget.
 *
 * Deliberately NOT folded into `getShop()`: that helper is `unstable_cache`d with
 * the `shops` tag, so the privacy decision (and the flag state it depends on) would
 * be memoized and outlive a revocation or activation.
 */
export async function assertShopNotPreviewPrivate(slug: string): Promise<void> {
  if (await isShopPreviewPrivateBySlug(slug)) notFound()
}

/** True when this single shop is preview-private (has a non-activated anchor). */
export async function isShopPreviewPrivate(shopId: string): Promise<boolean> {
  const preview = await getPreviewByShop(shopId)
  return preview !== null && preview.status !== 'activated'
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
 * `canAnchorPreview` now makes takedown impossible by construction (a claimed shop
 * can never be anchored), so removing it costs nothing. Un-hiding a shop is a
 * deliberate act: activate the approved snapshot (S2.3), or delete the anchor row.
 *
 * Fails OPEN to `false` (shop stays visible) on a read ERROR — a Supabase hiccup
 * must never 404 a live public shop, and the products themselves remain
 * draft-private regardless, so the failure mode is a bare shell, not a leaked
 * catalog.
 */
export async function isShopPreviewPrivateBySlug(slug: string): Promise<boolean> {
  const clean = (slug ?? '').trim()
  if (!clean) return false
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id')
    .eq('slug', clean)
    .maybeSingle()
  if (!shop?.id) return false
  return isShopPreviewPrivate(shop.id as string)
}

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
 * The proposed shop presentation a preview link renders — read from the Supabase
 * mirror (`marketplace_shops` + `marketplace_listings`), scoped to DRAFT rows.
 *
 * Why the mirror and not Medusa (AGENTS rule #1): the public /store/* API is
 * published-only and returns nothing for a draft, and the backend exposes no
 * internal GET for seller products — so the mirror is the only frontend-reachable
 * read for draft data, and it is the ESTABLISHED one for exactly this case (see
 * `listShopListings` in lib/seller-products.ts, and the seller catalog's own
 * mirror read at app/(shell)/shop/manage/catalogo/page.tsx). Medusa stays
 * authoritative: the mirror is written from the Medusa create, and activation
 * (S2.3) writes product status to Medusa and re-hashes the snapshot at that
 * moment — so the mirror is a display projection of the proposal, never the basis
 * of the publication decision.
 *
 * Exposes no admin/promoter controls, ownership, or checkout. Returns null if the
 * shop mirror row is gone.
 */
export async function getPreviewPresentation(
  preview: MerchantPreview,
): Promise<PreviewPresentation | null> {
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('name, slug')
    .eq('id', preview.shopId)
    .maybeSingle()
  if (!shop) return null

  // ONLY the proposed drafts. A shop can also hold already-public ('active')
  // listings — e.g. a preview prepared for a shop that already sells — and those
  // are not part of the proposal the merchant is being asked to approve. Scoping
  // here keeps the reviewed snapshot equal to what activation would publish.
  const { data: rows, error } = await db
    .from('marketplace_listings')
    .select('medusa_product_id, title, price_cents, currency, images, status')
    .eq('shop_id', preview.shopId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })

  // A failed query is NOT an empty proposal. Rendering "0 productos propuestos"
  // would show the merchant an empty shop and invite them to approve it — the
  // caller 404s instead, so a read failure can never become a consent artifact.
  if (error) return null

  const products: PreviewProduct[] = (rows ?? []).map((r) => {
    const images = Array.isArray(r.images) ? (r.images as Array<{ url?: string }>) : []
    return {
      id: String(r.medusa_product_id),
      title: String(r.title ?? ''),
      priceCents: typeof r.price_cents === 'number' ? r.price_cents : null,
      currency: String(r.currency ?? 'MXN'),
      imageUrl: images[0]?.url ?? null,
    }
  })

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
