/**
 * POST /api/orders/[id]/ship
 *
 * Creates an Envia.com shipment for the order, generates a label, and
 * transitions the order to 'shipped'. Seller only.
 *
 * Body:
 *   rateId      string  — Rate ID from a prior /ship/quote call
 *   weightGrams number  — Package weight in grams
 *   dimensions? { lengthCm, widthCm, heightCm }
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { createShipment, quoteShipments, type EnviaAddress } from '@/lib/envia'
import { toEnviaStateCode } from '@/lib/mx-locations'
import { sendOrderShipped } from '@/lib/email'
import { tg } from '@/lib/telegram'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

// Fetch seller + order context for Medusa-backed orders
async function getMedusaOrderContext(orderId: string, clerkJwt: string) {
  const [orderRes, sellerRes] = await Promise.all([
    fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${orderId}`, {
      headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY, Authorization: `Bearer ${clerkJwt}` },
    }),
    fetch(`${MEDUSA_BASE}/store/sellers/me`, {
      headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY, Authorization: `Bearer ${clerkJwt}` },
    }),
  ])
  if (!orderRes.ok) return null
  const { order } = await orderRes.json() as { order: Record<string, unknown> }
  const seller = sellerRes.ok ? ((await sellerRes.json()) as { seller?: Record<string, unknown> }).seller : null
  return { order, seller }
}

// ── POST /api/orders/[id]/ship ────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: {
    rateId?: string
    weightGrams?: number
    dimensions?: { lengthCm: number; widthCm: number; heightCm: number }
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  if (!body.rateId) return NextResponse.json({ error: 'rateId requerido.' }, { status: 400 })
  if (!body.weightGrams) return NextResponse.json({ error: 'weightGrams requerido.' }, { status: 400 })

  let orderStatus: string
  let shippingAddress: Record<string, string>
  let buyerName: string | null
  let buyerEmail: string | null
  let listingTitle: string
  let shopName: string
  let originRaw: Record<string, string> | undefined
  let supabaseOrderId: string | null = null

  if (id.startsWith('order_')) {
    // ── Medusa order ────────────────────────────────────────────────────────
    const { getToken } = await auth()
    const clerkJwt = await getToken()
    if (!clerkJwt) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

    const ctx = await getMedusaOrderContext(id, clerkJwt)
    if (!ctx) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

    const { order, seller } = ctx
    const listings = order.marketplace_listings as Record<string, unknown> | null
    orderStatus  = (order.status as string) ?? 'paid'
    shippingAddress = (order.shipping_address as Record<string, string>) ?? {}
    buyerName    = (order.buyer_name as string | null) ?? null
    buyerEmail   = (order.buyer_email as string | null) ?? null
    listingTitle = (listings?.title as string) ?? 'Producto'
    shopName     = ((order.marketplace_shops as Record<string, unknown>)?.name as string) ?? 'Mi tienda'

    const sellerMeta    = ((seller?.metadata ?? {}) as Record<string, unknown>)
    const sellerSettings = (sellerMeta.settings ?? {}) as Record<string, unknown>
    const shippingSettings = (sellerSettings.shipping ?? {}) as Record<string, unknown>
    originRaw    = shippingSettings.origin_address as Record<string, string> | undefined
  } else {
    // ── Legacy Supabase order ───────────────────────────────────────────────
    const { data: order } = await db
      .from('marketplace_orders')
      .select(`
        id, status, shipping_address, buyer_name, buyer_email,
        marketplace_shops!inner(id, clerk_user_id, name, metadata),
        marketplace_listings!inner(id, title)
      `)
      .eq('id', id)
      .maybeSingle()

    if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

    const shop    = order.marketplace_shops as unknown as { id: string; clerk_user_id: string | null; name: string; metadata: Record<string, unknown> | null }
    const listing = order.marketplace_listings as unknown as { id: string; title: string }

    if (shop.clerk_user_id !== user.id) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
    }

    orderStatus     = order.status
    shippingAddress = (order.shipping_address ?? {}) as Record<string, string>
    buyerName       = order.buyer_name ?? null
    buyerEmail      = order.buyer_email ?? null
    listingTitle    = listing.title
    shopName        = shop.name
    supabaseOrderId = id

    const shopMeta     = (shop.metadata ?? {}) as Record<string, unknown>
    const shopSettings = (shopMeta.settings ?? {}) as Record<string, unknown>
    const shippingSettings = (shopSettings.shipping ?? {}) as Record<string, unknown>
    originRaw = shippingSettings.origin_address as Record<string, string> | undefined
  }

  if (!['paid', 'processing'].includes(orderStatus)) {
    return NextResponse.json({ error: `No se puede enviar un pedido en estado "${orderStatus}".` }, { status: 422 })
  }

  if (!originRaw?.postal_code) {
    return NextResponse.json({
      error: 'Configura la dirección de origen de tu tienda en Ajustes antes de enviar.',
      code: 'MISSING_ORIGIN_ADDRESS',
    }, { status: 422 })
  }

  if (!shippingAddress.postal_code && !shippingAddress.postalCode) {
    return NextResponse.json({
      error: 'Este pedido no tiene dirección de entrega registrada.',
      code: 'MISSING_SHIPPING_ADDRESS',
    }, { status: 422 })
  }

  const origin: EnviaAddress = {
    name:       originRaw.name ?? shopName,
    street:     originRaw.street ?? '',
    number:     originRaw.number,
    district:   originRaw.colonia,
    city:       originRaw.city ?? '',
    state:      toEnviaStateCode(originRaw.state_code ?? originRaw.state ?? ''),
    country:    'MX',
    postalCode: originRaw.postal_code,
  }
  const destination: EnviaAddress = {
    name:       buyerName ?? shippingAddress.name ?? 'Comprador',
    street:     shippingAddress.street ?? shippingAddress.line1 ?? '',
    district:   shippingAddress.colonia ?? shippingAddress.line2,
    city:       shippingAddress.city ?? '',
    state:      toEnviaStateCode(shippingAddress.state_code ?? shippingAddress.state ?? ''),
    country:    'MX',
    postalCode: shippingAddress.postal_code ?? shippingAddress.postalCode ?? '',
    email:      buyerEmail ?? undefined,
  }

  const weightKg = body.weightGrams / 1000
  const pkg = {
    content:    listingTitle.slice(0, 80),
    weight:     Math.max(0.1, weightKg),
    dimensions: body.dimensions
      ? { length: body.dimensions.lengthCm, width: body.dimensions.widthCm, height: body.dimensions.heightCm }
      : { length: 20, width: 15, height: 10 },
  }

  let shipment
  try {
    shipment = await createShipment({ origin, destination, packages: [pkg], rateId: body.rateId!, reference: id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[envia] createShipment failed:', msg)
    return NextResponse.json({ error: `Error al generar etiqueta: ${msg}` }, { status: 502 })
  }

  // Record shipment in Supabase (for legacy orders; for Medusa orders we store in Medusa via PATCH)
  let shipmentRowId: string | undefined
  if (supabaseOrderId) {
    const { data: shipmentRow } = await db
      .from('marketplace_shipments')
      .insert({
        order_id:               supabaseOrderId,
        carrier:                shipment.carrier || 'envia',
        tracking_number:        shipment.trackingNumber,
        label_url:              shipment.labelUrl,
        envia_shipment_id:      shipment.enviaShipmentId,
        envia_rate_id:          body.rateId,
        status:                 'label_created',
        estimated_delivery_date: shipment.estimatedDeliveryDate ?? null,
        weight_grams:           body.weightGrams,
        metadata:               { raw: shipment.raw },
      })
      .select('id')
      .single()
    shipmentRowId = shipmentRow?.id
    await db.from('marketplace_orders').update({ status: 'shipped', updated_at: new Date().toISOString() }).eq('id', supabaseOrderId)
  } else {
    // Medusa order — update status via backend
    const { getToken } = await auth()
    const clerkJwt = await getToken()
    if (clerkJwt) {
      await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-publishable-api-key': MEDUSA_PUB_KEY,
          Authorization: `Bearer ${clerkJwt}`,
        },
        body: JSON.stringify({ status: 'shipped', carrier: shipment.carrier, tracking_number: shipment.trackingNumber }),
      }).catch(e => console.error('[envia] Medusa shipped update failed:', e))
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  if (buyerEmail) {
    sendOrderShipped({
      buyerEmail,
      buyerName,
      listingTitle,
      orderUrl: `${siteUrl}/account/orders/${id}`,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      estimatedDelivery: shipment.estimatedDeliveryDate,
      shopName,
    }).catch(e => console.error('[email] orderShipped:', e))
  }

  tg.alert(`📦 Pedido enviado — ${listingTitle}\nGuía: ${shipment.trackingNumber ?? 'sin guía'}\nComprador: ${buyerEmail}`)

  return NextResponse.json({
    shipmentId: shipmentRowId,
    trackingNumber: shipment.trackingNumber,
    labelUrl: shipment.labelUrl,
    carrier: shipment.carrier,
    estimatedDeliveryDate: shipment.estimatedDeliveryDate,
  })
}

// ── GET /api/orders/[id]/ship  (quote rates) ──────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const weightGrams = Number(sp.get('weightGrams') ?? '500')
  const lengthCm    = Number(sp.get('lengthCm') ?? '20')
  const widthCm     = Number(sp.get('widthCm')  ?? '15')
  const heightCm    = Number(sp.get('heightCm') ?? '10')

  let shippingAddress: Record<string, string>
  let buyerName: string | null
  let listingTitle: string
  let originRaw: Record<string, string> | undefined
  let shopName: string

  if (id.startsWith('order_')) {
    const { getToken } = await auth()
    const clerkJwt = await getToken()
    if (!clerkJwt) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

    const ctx = await getMedusaOrderContext(id, clerkJwt)
    if (!ctx) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

    const { order, seller } = ctx
    const listings = order.marketplace_listings as Record<string, unknown> | null
    shippingAddress = (order.shipping_address as Record<string, string>) ?? {}
    buyerName       = (order.buyer_name as string | null) ?? null
    listingTitle    = (listings?.title as string) ?? 'Producto'
    shopName        = ((order.marketplace_shops as Record<string, unknown>)?.name as string) ?? 'Mi tienda'

    const sellerMeta     = ((seller?.metadata ?? {}) as Record<string, unknown>)
    const sellerSettings = (sellerMeta.settings ?? {}) as Record<string, unknown>
    const shippingSettings = (sellerSettings.shipping ?? {}) as Record<string, unknown>
    originRaw = shippingSettings.origin_address as Record<string, string> | undefined
  } else {
    const { data: order } = await db
      .from('marketplace_orders')
      .select('id, shipping_address, buyer_name, marketplace_shops!inner(id, clerk_user_id, name, metadata), marketplace_listings!inner(title)')
      .eq('id', id)
      .maybeSingle()

    if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

    const shop = order.marketplace_shops as unknown as { clerk_user_id: string | null; name: string; metadata: Record<string, unknown> | null }
    if (shop.clerk_user_id !== user.id) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
    }

    shippingAddress = (order.shipping_address ?? {}) as Record<string, string>
    buyerName       = order.buyer_name ?? null
    shopName        = shop.name
    listingTitle    = (order.marketplace_listings as unknown as { title: string }).title

    const shopMeta     = (shop.metadata ?? {}) as Record<string, unknown>
    const shopSettings = (shopMeta.settings ?? {}) as Record<string, unknown>
    const shippingSettings = (shopSettings.shipping ?? {}) as Record<string, unknown>
    originRaw = shippingSettings.origin_address as Record<string, string> | undefined
  }

  if (!originRaw?.postal_code) {
    return NextResponse.json({ error: 'Configura la dirección de origen en Ajustes.', code: 'MISSING_ORIGIN_ADDRESS' }, { status: 422 })
  }
  if (!shippingAddress.postal_code && !shippingAddress.postalCode) {
    return NextResponse.json({ error: 'El pedido no tiene dirección de entrega.', code: 'MISSING_SHIPPING_ADDRESS' }, { status: 422 })
  }

  const origin: EnviaAddress = {
    name: originRaw.name ?? shopName,
    street: originRaw.street ?? '',
    city: originRaw.city ?? '',
    state: toEnviaStateCode(originRaw.state_code ?? originRaw.state ?? ''),
    country: 'MX',
    postalCode: originRaw.postal_code,
  }
  const destination: EnviaAddress = {
    name: buyerName ?? shippingAddress.name ?? 'Comprador',
    street: shippingAddress.street ?? shippingAddress.line1 ?? '',
    city: shippingAddress.city ?? '',
    state: toEnviaStateCode(shippingAddress.state_code ?? shippingAddress.state ?? ''),
    country: 'MX',
    postalCode: shippingAddress.postal_code ?? shippingAddress.postalCode ?? '',
  }

  try {
    const rates = await quoteShipments({
      origin,
      destination,
      packages: [{ content: listingTitle.slice(0, 80), weight: Math.max(0.1, weightGrams / 1000), dimensions: { length: lengthCm, width: widthCm, height: heightCm } }],
    })
    return NextResponse.json({ rates })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Error al cotizar: ${msg}` }, { status: 502 })
  }
}
