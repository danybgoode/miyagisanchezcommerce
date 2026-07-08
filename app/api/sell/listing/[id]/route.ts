import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'
import { getShopStripe } from '@/lib/stripe'
import { sanitizeFieldDefs } from '@/lib/personalization'
import { validateSlug } from '@/lib/slug'
import { isShortlinkSegmentTaken } from '@/lib/shortlink-server'
import { isEnabled } from '@/lib/flags'
import { closeMlProduct } from '@/lib/ml-publish-bridge'
import { notifyWriterOnPublish } from '@/lib/launchpad'
import { normalizeExcerpt, type Excerpt } from '@/lib/excerpt'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

/**
 * Best-effort: when a Miyagi product is archived (paused/deleted), close its
 * linked Mercado Libre item so the two never drift (epic 03 · S3 · US-8). Gated
 * on `ml.publish_enabled`; NEVER fails the archive on a ML hiccup. Only runs the
 * (flag-gated) shop lookup + close when publish is enabled, so it's a true no-op
 * while the feature ships dark.
 */
async function bestEffortCloseMl(userId: string, productId: string): Promise<void> {
  try {
    if (!(await isEnabled('ml.publish_enabled'))) return
    const { data: shop } = await db
      .from('marketplace_shops')
      .select('slug')
      .eq('clerk_user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (shop?.slug) await closeMlProduct(shop.slug, productId)
  } catch {
    /* never block the archive on a ML failure */
  }
}

function medusaFetch(path: string, clerkJwt: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
      ...(options?.headers ?? {}),
    },
  })
}

// ── PUT — edit listing fields ─────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params

  let body: {
    title?: string
    description?: string
    price_cents?: number | null
    quantity?: number | null
    weight_grams?: number | null
    attrs?: Record<string, unknown>
    custom_fields?: unknown
    short_slug?: string | null
    // Opciones (custom-print-products 2.4) — priced option dimensions +
    // per-variant quantity tiers. Contract + full validation live in the
    // backend (`_utils/seller-product-update.ts`); the proxy only shape-checks.
    option_dimensions?: Array<{ title: string; values: string[] }>
    variant_prices?: Record<string, number>
    variant_id?: string
    variant_tiers?: Array<{ min_quantity: number; max_quantity: number | null; amount: number }>
    // Unit cost (COGS) in centavos for the targeted variant — seller-private,
    // stored on variant metadata (profit-analyzer S1). null clears it.
    unit_cost_cents?: number | null
    // Free "Lee un adelanto" text sample for a digital listing (bookshop
    // launchpad S2.1). Stored on product metadata.excerpt; null/empty clears it.
    // Behind `launchpad.enabled` (checked below).
    excerpt?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  // Custom product short slug (mschz.org/[slug]) — validate format + flat-namespace
  // uniqueness up front. Empty/null clears it (falls back to the auto short code).
  let nextShortSlug: string | null | undefined
  if (body.short_slug !== undefined) {
    const raw = (body.short_slug ?? '').trim().toLowerCase()
    if (!raw) {
      nextShortSlug = null
    } else {
      const v = validateSlug(raw)
      if (!v.valid) return NextResponse.json({ error: v.reason, field: 'short_slug' }, { status: 422 })
      if (await isShortlinkSegmentTaken(raw, id)) {
        return NextResponse.json({ error: 'Ese enlace corto ya está en uso.', field: 'short_slug' }, { status: 409 })
      }
      nextShortSlug = raw
    }
  }

  if (body.title !== undefined) {
    const t = body.title.trim()
    if (t.length < 5) return NextResponse.json({ error: 'El título debe tener al menos 5 caracteres.', field: 'title' }, { status: 422 })
    if (t.length > 100) return NextResponse.json({ error: 'El título no puede superar los 100 caracteres.', field: 'title' }, { status: 422 })
  }
  if (body.price_cents !== undefined && body.price_cents !== null && body.price_cents < 0) {
    return NextResponse.json({ error: 'El precio no puede ser negativo.', field: 'price' }, { status: 422 })
  }
  if (body.quantity !== undefined && body.quantity !== null && (body.quantity < 0 || !Number.isFinite(body.quantity))) {
    return NextResponse.json({ error: 'La cantidad no puede ser negativa.', field: 'quantity' }, { status: 422 })
  }
  // Opciones payloads — shape checks only (integer-cents amounts; the backend
  // owns the real validation and its es-MX messages surface verbatim below).
  if (body.variant_prices !== undefined) {
    const vals = Object.values(body.variant_prices ?? {})
    if (vals.length === 0 || vals.some(v => !Number.isInteger(v) || v <= 0)) {
      return NextResponse.json({ error: 'Cada combinación necesita un precio entero en centavos mayor a 0.' }, { status: 422 })
    }
  }
  if (body.variant_tiers !== undefined && (!Array.isArray(body.variant_tiers)
    || body.variant_tiers.some(t => !t || !Number.isInteger(t.amount) || t.amount <= 0))) {
    return NextResponse.json({ error: 'Cada nivel necesita un precio entero en centavos mayor a 0.' }, { status: 422 })
  }
  if (body.unit_cost_cents !== undefined && body.unit_cost_cents !== null
    && (!Number.isInteger(body.unit_cost_cents) || body.unit_cost_cents < 0)) {
    return NextResponse.json({ error: 'El costo unitario debe ser de $0 o más.', field: 'unit_cost' }, { status: 422 })
  }
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'Sin cambios.' }, { status: 422 })
  }

  // Excerpt (bookshop launchpad S2.1) — gated on `launchpad.enabled`. Only touch
  // this field when it's present so the flag never affects an ordinary save; if
  // OFF, reject just this field (the editor is hidden while the flag is off, so
  // this only fires for a direct API call). `undefined` = not sent; `null` clears.
  let excerptUpdate: Excerpt | null | undefined
  if (body.excerpt !== undefined) {
    if (!(await isEnabled('launchpad.enabled'))) {
      return NextResponse.json({ error: 'No disponible.', field: 'excerpt' }, { status: 423 })
    }
    excerptUpdate = normalizeExcerpt(body.excerpt)
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  // Personalization field definitions → sanitised and stored on the Medusa
  // product metadata (the backend update path merges arbitrary metadata).
  const customFields = body.custom_fields !== undefined ? sanitizeFieldDefs(body.custom_fields) : undefined

  // Only call Medusa when a Medusa-owned field actually changed (a short_slug-only
  // save touches just the Supabase mirror).
  const hasMedusaFields = body.title !== undefined || body.description !== undefined
    || body.price_cents !== undefined || body.quantity !== undefined
    || body.weight_grams !== undefined || body.attrs !== undefined || customFields !== undefined
    || excerptUpdate !== undefined
    || body.option_dimensions !== undefined || body.variant_prices !== undefined
    || body.variant_tiers !== undefined || body.unit_cost_cents !== undefined
  // Compose ONE metadata object so custom_fields + excerpt never collide as two
  // `metadata` keys in the literal. The backend shallow-merges body.metadata into
  // the product's existing metadata (seller-product-update.ts), so sending only
  // the changed keys is safe; `excerpt: null` clears it.
  const metadataUpdate: Record<string, unknown> = {}
  if (customFields !== undefined) metadataUpdate.custom_fields = customFields
  if (excerptUpdate !== undefined) metadataUpdate.excerpt = excerptUpdate
  if (hasMedusaFields) {
    const res = await medusaFetch(`/store/sellers/me/products/${id}`, clerkJwt, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(body.title !== undefined && { title: body.title.trim() }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.price_cents !== undefined && { price_cents: body.price_cents }),
        ...(body.quantity !== undefined && body.quantity !== null && { quantity: Math.max(0, Math.floor(body.quantity)) }),
        ...(body.weight_grams !== undefined && { weight_grams: body.weight_grams }),
        ...(body.attrs !== undefined && { attrs: body.attrs }),
        ...(Object.keys(metadataUpdate).length > 0 && { metadata: metadataUpdate }),
        ...(body.option_dimensions !== undefined && { option_dimensions: body.option_dimensions }),
        ...(body.variant_prices !== undefined && { variant_prices: body.variant_prices }),
        ...(body.variant_id !== undefined && { variant_id: body.variant_id }),
        ...(body.variant_tiers !== undefined && { variant_tiers: body.variant_tiers }),
        ...(body.unit_cost_cents !== undefined && { unit_cost_cents: body.unit_cost_cents }),
      }),
    })

    if (res.status === 403) return NextResponse.json({ error: 'No tienes permiso para modificar este anuncio.' }, { status: 403 })
    if (res.status === 404) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
    if (!res.ok) {
      // Surface the backend's es-MX message verbatim, preserving 4xx statuses
      // (the Opciones flow shows exact 422 texts — order-history refusal,
      // tier-ladder gaps, mutual-exclusivity — instead of a generic error).
      const d = await res.json().catch(() => ({})) as { message?: string }
      const status = res.status >= 400 && res.status < 500 ? res.status : 500
      return NextResponse.json({ error: d.message ?? 'Error al guardar los cambios.' }, { status })
    }
  }

  // Merge a custom short slug into the mirror metadata (preserving short_code + the
  // rest). Done as a read-merge-write so we never clobber other metadata. A
  // successful convert also stamps `has_variants: true` — the publish-status-
  // independent multi-variant signal the edit form needs, since the price-grid
  // route can't answer for a paused/draft listing (cross-agent review catch,
  // Antigravity round 2, 2026-07-05). Dimensions can never be removed, so the
  // flag never needs clearing.
  const convertSucceeded = body.option_dimensions !== undefined
  let mirrorMetadata: Record<string, unknown> | undefined
  if (nextShortSlug !== undefined || convertSucceeded) {
    const { data: row } = await db
      .from('marketplace_listings').select('metadata').eq('medusa_product_id', id).maybeSingle()
    const meta = ((row?.metadata ?? {}) as Record<string, unknown>)
    if (nextShortSlug !== undefined) {
      if (nextShortSlug === null) delete (meta as Record<string, unknown>).short_slug
      else meta.short_slug = nextShortSlug
    }
    if (convertSucceeded) meta.has_variants = true
    mirrorMetadata = meta
  }

  // A successful convert replaces the flat price with per-combination prices —
  // keep the mirror's price_cents in sync as the cheapest combination (the
  // "desde $X" display price the Medusa listing shape derives from variants).
  let minVariantPrice = body.option_dimensions !== undefined && body.variant_prices
    ? Math.min(...Object.values(body.variant_prices))
    : undefined

  // A tier edit can change a variant's base (qty=1) price too — recompute the
  // mirror from the live price-grid so "desde $X" never goes stale (cross-agent
  // review catch, Antigravity, 2026-07-05). Same semantic as the backend's
  // toListingShape: min across variants of each variant's LOWEST-min_quantity
  // tier (the grid sorts tiers ascending, so tiers[0] is the base). Best-effort:
  // a failed read just leaves the mirror as-is rather than failing the save.
  if (body.variant_tiers !== undefined && minVariantPrice === undefined) {
    try {
      const gridRes = await fetch(`${MEDUSA_BASE}/store/listings/${id}/price-grid`, {
        headers: { 'x-publishable-api-key': PUB_KEY },
        cache: 'no-store',
      })
      if (gridRes.ok) {
        const grid = (await gridRes.json())?.price_grid as
          | { variants?: Array<{ tiers?: Array<{ amount?: number }> }> }
          | undefined
        const basePrices = (grid?.variants ?? [])
          .map(v => v.tiers?.[0]?.amount)
          .filter((a): a is number => typeof a === 'number' && a > 0)
        if (basePrices.length > 0) minVariantPrice = Math.min(...basePrices)
      }
    } catch { /* best-effort — keep the current mirror price */ }
  }

  await db
    .from('marketplace_listings')
    .update({
      ...(body.title !== undefined && { title: body.title.trim() }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price_cents !== undefined && { price_cents: body.price_cents }),
      ...(minVariantPrice !== undefined && Number.isFinite(minVariantPrice) && { price_cents: minVariantPrice }),
      ...(mirrorMetadata !== undefined && { metadata: mirrorMetadata }),
      updated_at: new Date().toISOString(),
    })
    .eq('medusa_product_id', id)

  return NextResponse.json({ id, updated: true, short_slug: nextShortSlug })
}

// ── Checkout viability check ──────────────────────────────────────────────────
// Returns an error string if the listing cannot support a complete buyer journey,
// or null if it's OK to publish.
//
// Rule (no "coordinate after purchase"): a physical product can only be published
// when the seller has BOTH a concrete delivery method (shipping or local pickup)
// AND a concrete payment method (MercadoPago, Stripe, SPEI, or DiMo). WhatsApp/
// phone are contact affordances, not payment methods. Other listing types
// (digital/service/rental) always have a viable path.

function normalizeClabe(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : ''
}

async function checkCheckoutViability(listingId: string, clerkJwt: string): Promise<string | null> {
  try {
    // Load the listing and its seller's shop metadata
    const [listingRes, sellerRes] = await Promise.all([
      medusaFetch(`/store/listings/${listingId}`, clerkJwt),
      medusaFetch('/store/sellers/me', clerkJwt),
    ])
    if (!listingRes.ok || !sellerRes.ok) return null // non-fatal — allow publish on error

    const { listing } = await listingRes.json() as { listing: Record<string, unknown> }
    const { seller }  = await sellerRes.json()  as { seller: Record<string, unknown> }

    // Only check physical products — digital/service/rental always have a path
    const listingType = (listing?.metadata as Record<string, unknown> | null)?.listing_type as string ?? 'product'
    if (listingType !== 'product') return null

    const shopMeta   = (seller?.metadata ?? {}) as Record<string, unknown>
    const settings   = (shopMeta.settings ?? {}) as Record<string, unknown>
    const shipping   = (settings.shipping  ?? {}) as Record<string, unknown>
    const checkout   = (settings.checkout  ?? {}) as Record<string, unknown>

    // 1. Concrete delivery — shipping (Envia origin set) or local pickup.
    const hasLiveShipping = shipping.envia_enabled !== false && (() => {
      const oa = (shipping.origin_address ?? {}) as Record<string, string | null>
      return !!(oa.street && oa.city && oa.postal_code && (oa.state_code || oa.state))
    })()
    const hasLocalPickup = !!shipping.local_pickup
    const hasDelivery = hasLiveShipping || hasLocalPickup

    // 2. Concrete payment — online (MP/Stripe) or manual (SPEI/DiMo). Cash needs
    //    pickup so it's covered by the delivery check; WhatsApp/phone don't count.
    const stripe = getShopStripe(shopMeta)
    const hasStripe = !!(stripe.charges_enabled && stripe.account_id && stripe.enabled !== false)
    const hasMp     = sellerHasMpConnected(shopMeta)
    const bankTransfer = (checkout.bank_transfer ?? {}) as Record<string, unknown>
    const hasSpei   = bankTransfer.enabled !== false && normalizeClabe(bankTransfer.clabe).length === 18
    const dimo      = (checkout.dimo ?? {}) as Record<string, unknown>
    const hasDimo   = dimo.enabled === true && normalizeClabe(dimo.phone).length >= 10
    const hasPayment = hasStripe || hasMp || hasSpei || hasDimo

    if (hasDelivery && hasPayment) return null

    const missing: string[] = []
    if (!hasDelivery) missing.push('una forma de entrega (envío a domicilio o recolección en mano)')
    if (!hasPayment)  missing.push('un método de pago (MercadoPago, Stripe, SPEI o DiMo)')

    return `Para activar este anuncio configura ${missing.join(' y ')}. ` +
      'Ve a Mi tienda → Configuración → Pagos y Envíos.'
  } catch {
    return null // on unexpected error, allow publish (fail open)
  }
}

// ── PATCH — update listing status ─────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params

  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const allowed = ['active', 'paused']
  if (!body.status || !allowed.includes(body.status)) {
    return NextResponse.json({ error: 'Estado inválido. Usa "active" o "paused".' }, { status: 422 })
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  // ── Checkout viability gate (activating only) ────────────────────────────────
  // A product listing with coord-only delivery can only be published if the seller
  // has at least one manual payment method configured — otherwise buyers have no
  // way to complete a purchase and the checkout is unreachable.
  if (body.status === 'active') {
    const viabilityError = await checkCheckoutViability(id, clerkJwt)
    if (viabilityError) return NextResponse.json({ error: viabilityError }, { status: 422 })
  }

  // Map frontend status → Medusa product status. "paused" and a never-published
  // draft both land on Medusa's native `status: 'draft'` — `metadata.paused` is
  // the only thing that tells them apart (toListingShape reads it), so it's set
  // in the SAME call that flips status, never a separate round-trip.
  const medusaStatus = body.status === 'active' ? 'published' : 'draft'

  const res = await medusaFetch(`/store/sellers/me/products/${id}`, clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({ status: medusaStatus, metadata: { paused: body.status === 'paused' } }),
  })

  if (res.status === 403) return NextResponse.json({ error: 'No tienes permiso para modificar este anuncio.' }, { status: 403 })
  if (res.status === 404) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  if (!res.ok) return NextResponse.json({ error: 'Error al actualizar el anuncio.' }, { status: 500 })

  await db
    .from('marketplace_listings')
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq('medusa_product_id', id)

  // Pausing a Miyagi listing closes its linked ML item (US-8); reactivating is the
  // seller's explicit "Sincronizar" action, not an automatic relist.
  if (body.status === 'paused') await bestEffortCloseMl(userId, id)

  // Bookshop launchpad (S1.3): first activation of a launchpad-minted listing
  // emails the writer the live URL — once. No-op for any non-launchpad product.
  if (body.status === 'active') await notifyWriterOnPublish(id).catch(() => {})

  return NextResponse.json({ id, status: body.status })
}

// ── DELETE — unpublish listing ────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { id } = await params

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await medusaFetch(`/store/sellers/me/products/${id}`, clerkJwt, { method: 'DELETE' })

  if (res.status === 403) return NextResponse.json({ error: 'No tienes permiso para eliminar este anuncio.' }, { status: 403 })
  if (res.status === 404) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  if (!res.ok) return NextResponse.json({ error: 'Error al eliminar el anuncio.' }, { status: 500 })

  await db
    .from('marketplace_listings')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('medusa_product_id', id)

  // Deleting a Miyagi listing closes its linked ML item (US-8) — keyed off the
  // linkage, so it still works now that the product is soft-deleted.
  await bestEffortCloseMl(userId, id)

  return NextResponse.json({ id, deleted: true })
}
