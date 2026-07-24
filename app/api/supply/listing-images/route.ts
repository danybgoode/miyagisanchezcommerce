/**
 * Supply image backfill — headless, admin-secret-gated endpoint to add or
 * replace images on an ALREADY-imported gem listing (Gem → Claimable Shop Loop
 * follow-up). The importer (`/api/supply/import`) is create-only and dedupes on
 * canonical `source_url`, so re-importing never refreshes media — older gems are
 * stuck at one photo and their PDP gallery never kicks in. This closes that gap.
 *
 *   POST /api/supply/listing-images
 *   Auth: Clerk admin session OR shared ADMIN_SECRET (via withSupplyAdmin) — the
 *         importer runs headless, no Clerk; same secret as the rest of /api/supply/*.
 *   body: {
 *     source_url?: string,    // resolve by canonical source_url (importer's dedupe key)
 *     product_id?: string,    // OR Medusa product id (prod_...)
 *     images: [{ url, alt? }], // hosted URLs (e.g. from /api/supply/upload)
 *     mode?: 'append' | 'replace'   // default 'append'; append de-dupes by URL
 *   }
 *   → { product_id, mode, images: [{ url, alt }], mirror_updated }
 *
 * Wiring: updates the Medusa product (the storefront's only read model — getListing
 * reads product images) via the internal PATCH /internal/seller-products/:id, then
 * mirrors the final set into the Supabase marketplace_listings.images column
 * (non-fatal), and revalidates the listings/shops tags so the PDP refreshes
 * without waiting out ISR.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/supabase'
import { withSupplyAdmin } from '@/lib/admin/guard'
import { canonicalSourceUrl } from '@/lib/supply'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''
// Match the store read model (lib/listings.ts uses NEXT_PUBLIC_…); fall back to
// the AGENTS-documented MEDUSA_PUBLISHABLE_KEY so the slug fallback can't silently
// fail on an env that only sets one of the two names.
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? process.env.MEDUSA_PUBLISHABLE_KEY ?? ''

type ImageInput = { url?: unknown; alt?: unknown }
type FinalImage = { url: string; alt: string | null }

const isHttpUrl = (u: string) => /^https?:\/\//i.test(u)

/** Fallback seller-slug resolution straight from the Medusa read model. */
async function sellerSlugFromStore(productId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${productId}`, {
      headers: { 'x-publishable-api-key': PUB_KEY, 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null) as { listing?: { shop?: { slug?: string } } } | null
    return data?.listing?.shop?.slug ?? null
  } catch {
    return null
  }
}

export const POST = withSupplyAdmin(async (req: NextRequest) => {
  if (!INTERNAL_SECRET) {
    return NextResponse.json({ error: 'MEDUSA_INTERNAL_SECRET is not configured' }, { status: 500 })
  }

  const body = await req.json().catch(() => null) as {
    source_url?: string
    product_id?: string
    images?: ImageInput[]
    mode?: string
  } | null

  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const mode: 'append' | 'replace' = body.mode === 'replace' ? 'replace' : 'append'

  // Validate the incoming image list — absolute http(s) hosted URLs only (e.g.
  // from /api/supply/upload). Reject the whole request on a bad URL so a headless
  // caller learns about it instead of silently persisting garbage to Medusa.
  const images: FinalImage[] = []
  const invalidUrls: string[] = []
  for (const img of (Array.isArray(body.images) ? body.images : [])) {
    if (!img || typeof img.url !== 'string') continue
    const url = img.url.trim()
    if (!url) continue
    if (!isHttpUrl(url)) { invalidUrls.push(url); continue }
    images.push({ url, alt: typeof img.alt === 'string' && img.alt.trim() ? img.alt.trim() : null })
  }

  if (invalidUrls.length > 0) {
    return NextResponse.json(
      { error: `images must be absolute http(s) URLs; rejected: ${invalidUrls.join(', ')}` },
      { status: 422 },
    )
  }
  if (images.length === 0) {
    return NextResponse.json({ error: 'images must be a non-empty array of { url }' }, { status: 422 })
  }

  // ── Resolve the listing → Medusa product id + Supabase mirror row ───────────
  // product_id wins when both are given (explicit target); otherwise resolve via
  // the canonical source_url the importer deduped on.
  let productId: string | null = null
  let mirror: { id: string; shop_id: string | null } | null = null

  const explicitProductId = typeof body.product_id === 'string' && body.product_id.trim()
    ? body.product_id.trim()
    : null

  if (explicitProductId) {
    productId = explicitProductId
    const { data } = await db
      .from('marketplace_listings')
      .select('id, shop_id')
      .eq('medusa_product_id', productId)
      .maybeSingle()
    mirror = data ? { id: data.id as string, shop_id: (data.shop_id as string | null) ?? null } : null
  } else if (body.source_url) {
    const canon = canonicalSourceUrl(body.source_url)
    if (!canon) {
      return NextResponse.json({ error: 'source_url could not be canonicalized' }, { status: 422 })
    }
    const { data } = await db
      .from('marketplace_listings')
      .select('id, shop_id, medusa_product_id')
      .eq('source_url', canon)
      .maybeSingle()
    if (!data?.medusa_product_id) {
      return NextResponse.json({ error: `No imported listing found for source_url ${canon}` }, { status: 404 })
    }
    productId = data.medusa_product_id as string
    mirror = { id: data.id as string, shop_id: (data.shop_id as string | null) ?? null }
  }

  if (!productId) {
    return NextResponse.json({ error: 'Provide source_url or product_id' }, { status: 422 })
  }

  // ── seller_slug for the internal PATCH ownership double-check ────────────────
  let sellerSlug: string | null = null
  if (mirror?.shop_id) {
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('slug')
      .eq('id', mirror.shop_id)
      .maybeSingle()
    sellerSlug = (shop?.slug as string | undefined) ?? null
  }
  if (!sellerSlug) sellerSlug = await sellerSlugFromStore(productId)
  if (!sellerSlug) {
    return NextResponse.json({ error: 'Could not resolve the seller for this listing' }, { status: 404 })
  }

  // ── Update the Medusa product images (the storefront read model) ────────────
  const patchRes = await fetch(`${MEDUSA_BASE}/internal/seller-products/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify({ seller_slug: sellerSlug, images, images_mode: mode }),
  })
  const patchData = await patchRes.json().catch(() => ({})) as {
    product_id?: string
    images?: FinalImage[]
    message?: string
  }

  if (!patchRes.ok) {
    const status = patchRes.status === 403 || patchRes.status === 404 ? patchRes.status : 502
    return NextResponse.json(
      { error: `Image update failed (${patchRes.status}): ${patchData.message ?? 'no data'}` },
      { status },
    )
  }

  // The backend echoes the merged, de-duped set; fall back to the input if absent.
  const finalImages: FinalImage[] = patchData.images ?? images

  // ── Mirror the new image set to Supabase (non-fatal, importer pattern) ───────
  let mirrorUpdated = false
  if (mirror?.id) {
    const { error } = await db
      .from('marketplace_listings')
      .update({ images: finalImages, updated_at: new Date().toISOString() })
      .eq('id', mirror.id)
    if (error) {
      console.error('[supply/listing-images] mirror update failed (non-fatal):', error.message)
    } else {
      mirrorUpdated = true
    }
  }

  // Refresh the PDP / shop grid without waiting out the ISR window.
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({
    product_id: productId,
    mode,
    images: finalImages,
    mirror_updated: mirrorUpdated,
  })
})
