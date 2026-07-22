/**
 * POST /api/promoter/close/listing — a bound promoter adds a real listing
 * (title, price, category, photos) to a merchant's shop during the in-person
 * close (epic 08 · promoter-funnel-v2 S5 · US-5.1), so the shop looks real —
 * populated at /s/[slug] and in search — before the promoter ever walks out.
 *
 * Can't reuse POST /api/sell/create — that route resolves the seller via the
 * CALLER's own Clerk session (/store/sellers/me), which fails for an unclaimed
 * shop (clerk_user_id: null). Instead calls createSellerProductViaInternal
 * directly, the same primitive the MCP create_listing tool already uses.
 *
 * Publish status: by default (flag OFF) this ALWAYS force-publishes — unlike a
 * self-serve listing it never runs listingActivationBlock's delivery/payment gate.
 * That gate exists to stop a live listing no buyer could check out on, but an
 * unclaimed shop's checkout is already fully blocked by isShopClaimed() regardless
 * of publish status, so the gate would be redundant here and would only hide the
 * listing from /s/[slug], defeating the story's point.
 *
 * Consent-safe preview (founding-merchant-consent-previews S1.1): when
 * `promoter.private_preview_enabled` is ON, this instead creates the product as a
 * native Medusa `status:'draft'` product — structurally excluded from every public
 * /store/* read seam (search, PDP, seller products, sitemap, agent, embed) — and
 * ensures a per-shop preview anchor. Nothing is public until the merchant approves
 * and the promoter activates (Sprint 2).
 *
 * Flag OFF preserves the force-publish path exactly for any shop that was NEVER
 * anchored — which is the rollback for the feature as a whole. It is NOT a
 * per-shop undo: a shop that already carries a non-activated anchor stays private
 * regardless of the flag, because a flag flip is not merchant consent. Un-hiding
 * one shop is a deliberate act (activate the approved snapshot in Sprint 2, or
 * delete its `merchant_previews` row).
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { revalidateTag } from 'next/cache'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { getPromoterByClerkId } from '@/lib/promoter'
import { resolveTargetShop } from '@/lib/promoter-server'
import { createSellerProductViaInternal } from '@/lib/seller-products'
import { syncSupabaseListingMirror } from '@/lib/provisioning'
import { CATALOG_CATEGORY_KEYS } from '@/lib/catalog-import'
import {
  ensureShopPreviewReportingCreation,
  getPreviewByShop,
  canAnchorPreview,
  shopMustStayPrivate,
  shopHasPublicListings,
} from '@/lib/preview-access'
import { invalidateIfMaterialChange } from '@/lib/preview-consent'
import { emitPreviewEvent } from '@/lib/preview-lifecycle'

export const dynamic = 'force-dynamic'

interface Body {
  shopId?: string
  slug?: string
  title?: string
  price_mxn?: number
  category?: string
  condition?: string
  images?: Array<{ url: string; alt?: string }>
}

export async function POST(req: NextRequest) {
  if (!(await isEnabled('promoter.enabled'))) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const user = await currentUser().catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })

  const rl = await checkRateLimit('checkout', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const promoter = await getPromoterByClerkId(user.id)
  if (!promoter) {
    return NextResponse.json({ ok: false, error: 'Vincula tu código de promotor primero.' }, { status: 403 })
  }

  let body: Body = {}
  try { body = await req.json() } catch { /* validated below */ }

  const title = (body.title ?? '').trim()
  if (title.length < 3) {
    return NextResponse.json({ ok: false, error: 'Escribe un título para el anuncio (mínimo 3 caracteres).' }, { status: 400 })
  }
  const category = (body.category ?? '').trim()
  if (!CATALOG_CATEGORY_KEYS.includes(category as (typeof CATALOG_CATEGORY_KEYS)[number])) {
    return NextResponse.json({ ok: false, error: 'Elige una categoría válida.' }, { status: 400 })
  }

  const shop = await resolveTargetShop({ shopId: body.shopId, slug: body.slug })
  if (!shop) return NextResponse.json({ ok: false, error: 'Tienda no encontrada.' }, { status: 404 })

  // Consent-safe preview: when ON *and this promoter may anchor this shop*, create
  // the listing PRIVATE (Medusa draft + mirror 'draft'). Otherwise publish as
  // before — EXCEPT for a shop that already carries a non-activated anchor, which
  // stays private regardless of the flag or the caller (see below). So flag-OFF is
  // today's behavior for every shop that was never anchored, not for all shops.
  //
  // `canAnchorPreview` is load-bearing here, not just on the preview route: an
  // anchor hides the storefront, so anchoring a shop this promoter didn't create —
  // or a CLAIMED shop that's already trading — would take a live merchant down.
  // A promoter adding a listing to someone else's live shop therefore keeps the
  // old publish behavior rather than silently going private.
  //
  // The ANCHOR is authoritative, ahead of the flag and ahead of who is calling: a
  // shop already awaiting its merchant's consent must never receive a published
  // product — not during a flag-store outage (the enablement flag falls open to
  // `false`, which would force-publish), and not because a DIFFERENT promoter is
  // the one adding the listing (`canAnchorPreview` is false for them, which must
  // mean "you may not anchor", never "publish freely into it").
  const alreadyPrivate = await shopMustStayPrivate(shop.id)

  let privatePreview =
    alreadyPrivate ||
    ((await isEnabled('promoter.private_preview_enabled')) && canAnchorPreview(shop, promoter.code))

  // Only the shop's own promoter may CREATE the anchor; an existing one is
  // honored no matter who is calling. Creating one also requires that the shop
  // isn't ALREADY publicly trading — anchoring a shop with live listings would
  // hide a working storefront (locked decision #4: existing public/unclaimed
  // shops are audited, not mutated). The whole pre-epic promoter-close install
  // base has that shape.
  if (privatePreview && !alreadyPrivate && (await shopHasPublicListings(shop.id))) {
    privatePreview = false
  } else if (privatePreview && !alreadyPrivate) {
    // Anchor BEFORE creating the product, so a failed anchor costs nothing. (The
    // shop-setup path already anchored at shop creation, so this is normally a
    // no-op read.) Anchoring first is safe precisely because this shop is
    // promoter-created and unclaimed: an anchor on a product-less shop of that
    // kind is the correct state, not a stranded one — whereas creating the
    // product first would leave an untracked draft that a retry duplicates.
    const anchored = await ensureShopPreviewReportingCreation(shop.id, user.id)
    if (!anchored.preview) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo preparar la vista previa privada. Inténtalo de nuevo.' },
        { status: 500 },
      )
    }
    // Lifecycle telemetry (S3.1) — only for a genuinely new anchor, after the
    // canonical write. Never fails the listing.
    if (anchored.created) {
      await emitPreviewEvent('preview_created', {
        shopId: shop.id,
        previewId: anchored.preview.id,
        version: anchored.preview.currentVersion,
      })
    }
    // An ALREADY-ACTIVATED shop is public and out of the consent flow — creating a
    // hidden draft against it would strand a product nobody can see and mint a
    // preview link that always 404s. Fall back to the ordinary publish path.
    if (anchored.preview.status === 'activated') privatePreview = false
  }

  const listingStatus: 'published' | 'draft' = privatePreview ? 'draft' : 'published'
  const mirrorStatus = privatePreview ? 'draft' : 'active'

  const priceCents = typeof body.price_mxn === 'number' && body.price_mxn > 0
    ? Math.round(body.price_mxn * 100)
    : null
  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : []
  const locationDetail = (shop.metadata.location_detail ?? null) as
    | { estado?: string | null; municipio?: string | null }
    | null

  const result = await createSellerProductViaInternal(shop.slug, {
    title,
    category,
    price_cents: priceCents,
    currency: 'MXN',
    condition: body.condition?.trim() || null,
    listing_type: 'product',
    state: locationDetail?.estado ?? null,
    municipio: locationDetail?.municipio ?? null,
    quantity: 1,
    // Force-published (flag OFF) or private draft (flag ON) — see file header.
    // Never gated by listingActivationBlock either way.
    status: listingStatus,
    images,
  })
  if (!result.ok || !result.product_id) {
    return NextResponse.json({ ok: false, error: result.error ?? 'No se pudo crear el anuncio.' }, { status: 502 })
  }

  await syncSupabaseListingMirror(shop.id, {
    id: result.product_id,
    title,
    category,
    price_cents: priceCents,
    currency: 'MXN',
    condition: body.condition?.trim() || null,
    listing_type: 'product',
    state: locationDetail?.estado ?? null,
    municipio: locationDetail?.municipio ?? null,
    images,
    status: mirrorStatus,
  })

  // Consent-safe previews (S2.2) — adding a product is a MATERIAL change: the set
  // the merchant reviewed is no longer what would be published. If this shop had a
  // current approval, it is now stale, so invalidate it and return the preview to
  // review. Idempotent + safe: only touches an anchor whose approved snapshot no
  // longer matches (a shop with no approval, or one that didn't materially change,
  // is left completely alone). Best-effort — a telemetry-grade step that must never
  // fail the listing write that already succeeded.
  if (privatePreview) {
    const pv = await getPreviewByShop(shop.id)
    if (pv) {
      const outcome = await invalidateIfMaterialChange(pv).catch(() => ({ invalidated: false, reasons: [] }))
      // Lifecycle telemetry (S3.1) — only when consent actually went stale.
      if (outcome.invalidated) {
        await emitPreviewEvent('preview_invalidated', {
          shopId: shop.id,
          previewId: pv.id,
          version: pv.currentVersion,
        })
      }
    }
  }

  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({ ok: true, productId: result.product_id, private: privatePreview })
}
