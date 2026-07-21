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
import { db } from '@/lib/supabase'
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
 * A shop is "preview-private" (must be hidden from every public shop-shell read)
 * when it has a preview anchor that has not yet been activated. Returns the set of
 * such shop ids among the given ids — the S1.2 cross-channel leak guard uses this
 * to filter shop listings/sitemap/search without a per-shop round trip.
 */
export async function filterPreviewPrivateShopIds(shopIds: string[]): Promise<Set<string>> {
  if (shopIds.length === 0) return new Set()
  const { data } = await db
    .from('merchant_previews')
    .select('shop_id')
    .in('shop_id', shopIds)
    .neq('status', 'activated')
  return new Set((data ?? []).map((r) => r.shop_id as string))
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
 * the Medusa seller id, not the mirror id previews key off). Fails OPEN to `false`
 * (shop stays visible) on any read error — a Supabase hiccup must never 404 a live
 * public shop; the products themselves are already draft-private regardless.
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
 * mirror (`marketplace_shops` + `marketplace_listings`), NEVER the public /store/*
 * API (which is published-only and would return nothing for a draft preview). This
 * is the ONE read path that sees the private proposal; it exposes no admin/promoter
 * controls, ownership, or checkout. Returns null if the shop mirror row is gone.
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

  const { data: rows } = await db
    .from('marketplace_listings')
    .select('medusa_product_id, title, price_cents, currency, images, status')
    .eq('shop_id', preview.shopId)
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })

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
  return preview ? rowToPreview(preview) : null
}

/**
 * Revoke every active grant for a preview (the "revoke the link" action). Idempotent.
 * Returns the number of grants revoked. A revoked grant resolves as absent thereafter.
 */
export async function revokePreviewGrants(previewId: string): Promise<number> {
  const { data, error } = await db
    .from('merchant_preview_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('preview_id', previewId)
    .is('revoked_at', null)
    .select('id')
  if (error || !data) return 0
  return data.length
}
