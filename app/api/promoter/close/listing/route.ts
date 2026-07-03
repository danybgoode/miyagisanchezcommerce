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
 * Publish status: unlike a self-serve listing, this ALWAYS force-publishes
 * (never runs listingActivationBlock's delivery/payment gate). That gate exists
 * to stop a live listing no buyer could check out on — but an unclaimed shop's
 * checkout is already fully blocked by isShopClaimed() regardless of publish
 * status, so the gate would be redundant here and would only hide the listing
 * from /s/[slug], defeating the story's point.
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
    // Force-published — see file header. Never gated by listingActivationBlock.
    status: 'published',
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
    status: 'active',
  })

  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return NextResponse.json({ ok: true, productId: result.product_id })
}
