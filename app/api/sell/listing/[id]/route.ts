import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

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
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

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
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'Sin cambios.' }, { status: 422 })
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await medusaFetch(`/store/sellers/me/products/${id}`, clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(body.title !== undefined && { title: body.title.trim() }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price_cents !== undefined && { price_cents: body.price_cents }),
      ...(body.quantity !== undefined && body.quantity !== null && { quantity: Math.max(0, Math.floor(body.quantity)) }),
      ...(body.weight_grams !== undefined && { weight_grams: body.weight_grams }),
      ...(body.attrs !== undefined && { attrs: body.attrs }),
    }),
  })

  if (res.status === 403) return NextResponse.json({ error: 'No tienes permiso para modificar este anuncio.' }, { status: 403 })
  if (res.status === 404) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { message?: string }
    return NextResponse.json({ error: d.message ?? 'Error al guardar los cambios.' }, { status: 500 })
  }

  await db
    .from('marketplace_listings')
    .update({
      ...(body.title !== undefined && { title: body.title.trim() }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price_cents !== undefined && { price_cents: body.price_cents }),
      updated_at: new Date().toISOString(),
    })
    .eq('medusa_product_id', id)

  return NextResponse.json({ id, updated: true })
}

// ── Checkout viability check ──────────────────────────────────────────────────
// Returns an error string if the listing cannot support a complete buyer journey,
// or null if it's OK to publish.
//
// Rule: physical product with coord-only delivery (no Envia, no local pickup)
// must have at least one manual payment method (SPEI, WhatsApp, or phone).
// All other listing types always have a viable path.

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
    const theme      = (settings.theme     ?? {}) as Record<string, unknown>

    // Check if structured delivery is available
    const hasLiveShipping = shipping.envia_enabled !== false && (() => {
      const oa = (shipping.origin_address ?? {}) as Record<string, string | null>
      return !!(oa.street && oa.city && oa.postal_code && (oa.state_code || oa.state))
    })()
    const hasLocalPickup = !!shipping.local_pickup

    if (hasLiveShipping || hasLocalPickup) return null // has a structured delivery → card is available

    // Coord-only: check for at least one manual payment method
    const bankTransfer = (checkout.bank_transfer ?? {}) as Record<string, unknown>
    const hasSpei      = !!(bankTransfer.enabled && (bankTransfer.clabe as string)?.length === 18)
    const whatsappNum  = (theme as any)?.social?.whatsapp ?? checkout.phone
    const hasWhatsapp  = !!(checkout.whatsapp_cta && whatsappNum)
    const hasPhone     = !!(checkout.show_phone && checkout.phone)

    if (hasSpei || hasWhatsapp || hasPhone) return null // has a manual payment path → OK

    return [
      'Para activar este anuncio necesitas configurar al menos un método de pago manual',
      '(SPEI, WhatsApp o teléfono visible) o activar el envío a domicilio / recolección.',
      'Sin esto, los compradores no tienen forma de pagar. Ve a Mi tienda → Configuración → Pagos y Envíos.',
    ].join(' ')
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

  // Map frontend status → Medusa product status
  const medusaStatus = body.status === 'active' ? 'published' : 'draft'

  const res = await medusaFetch(`/store/sellers/me/products/${id}`, clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({ status: medusaStatus }),
  })

  if (res.status === 403) return NextResponse.json({ error: 'No tienes permiso para modificar este anuncio.' }, { status: 403 })
  if (res.status === 404) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  if (!res.ok) return NextResponse.json({ error: 'Error al actualizar el anuncio.' }, { status: 500 })

  await db
    .from('marketplace_listings')
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq('medusa_product_id', id)

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

  return NextResponse.json({ id, deleted: true })
}
