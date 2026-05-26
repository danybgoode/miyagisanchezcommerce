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
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { createShipment, quoteShipments, type EnviaAddress } from '@/lib/envia'
import { sendOrderShipped, getSellerEmail } from '@/lib/email'
import { tg } from '@/lib/telegram'

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

  // ── Fetch order + verify seller owns it ──────────────────────────────────
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

  if (!['paid', 'processing'].includes(order.status)) {
    return NextResponse.json({ error: `No se puede enviar un pedido en estado "${order.status}".` }, { status: 422 })
  }

  // ── Get origin address from shop settings ─────────────────────────────────
  const shopMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const shopSettings = (shopMeta.settings ?? {}) as Record<string, unknown>
  const originRaw = shopSettings.origin_address as Record<string, string> | undefined

  if (!originRaw?.postal_code) {
    return NextResponse.json({
      error: 'Configura la dirección de origen de tu tienda en Ajustes antes de enviar.',
      code: 'MISSING_ORIGIN_ADDRESS',
    }, { status: 422 })
  }

  // ── Parse shipping address (collected at Stripe checkout) ─────────────────
  const destRaw = (order.shipping_address ?? {}) as Record<string, string>
  if (!destRaw.postal_code && !destRaw.postalCode) {
    return NextResponse.json({
      error: 'Este pedido no tiene dirección de entrega registrada.',
      code: 'MISSING_SHIPPING_ADDRESS',
    }, { status: 422 })
  }

  const origin: EnviaAddress = {
    name:       originRaw.name ?? shop.name,
    street:     originRaw.street ?? '',
    number:     originRaw.number,
    district:   originRaw.colonia,
    city:       originRaw.city ?? '',
    state:      originRaw.state ?? '',
    postalCode: originRaw.postal_code,
  }

  const destination: EnviaAddress = {
    name:       order.buyer_name ?? destRaw.name ?? 'Comprador',
    street:     destRaw.street ?? destRaw.line1 ?? '',
    district:   destRaw.colonia ?? destRaw.line2,
    city:       destRaw.city ?? '',
    state:      destRaw.state ?? '',
    postalCode: destRaw.postal_code ?? destRaw.postalCode ?? '',
    email:      order.buyer_email ?? undefined,
  }

  const weightKg = body.weightGrams / 1000
  const pkg = {
    content:    listing.title.slice(0, 80),
    weight:     Math.max(0.1, weightKg),
    dimensions: body.dimensions
      ? { length: body.dimensions.lengthCm, width: body.dimensions.widthCm, height: body.dimensions.heightCm }
      : { length: 20, width: 15, height: 10 },
  }

  // ── Create shipment via Envia ──────────────────────────────────────────────
  let shipment
  try {
    shipment = await createShipment({
      origin,
      destination,
      packages: [pkg],
      rateId: body.rateId,
      reference: id,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[envia] createShipment failed:', msg)
    return NextResponse.json({ error: `Error al generar etiqueta: ${msg}` }, { status: 502 })
  }

  // ── Record shipment in DB ─────────────────────────────────────────────────
  const { data: shipmentRow } = await db
    .from('marketplace_shipments')
    .insert({
      order_id:               id,
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

  // ── Update order status → shipped ─────────────────────────────────────────
  await db
    .from('marketplace_orders')
    .update({ status: 'shipped', updated_at: new Date().toISOString() })
    .eq('id', id)

  // ── Email buyer ───────────────────────────────────────────────────────────
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  if (order.buyer_email) {
    sendOrderShipped({
      buyerEmail:       order.buyer_email,
      buyerName:        order.buyer_name ?? null,
      listingTitle:     listing.title,
      orderUrl:         `${siteUrl}/account/orders/${id}`,
      carrier:          shipment.carrier,
      trackingNumber:   shipment.trackingNumber,
      estimatedDelivery: shipment.estimatedDeliveryDate,
      shopName:         shop.name,
    }).catch(e => console.error('[email] orderShipped:', e))
  }

  // ── Telegram ──────────────────────────────────────────────────────────────
  tg.alert(`📦 Pedido enviado — ${listing.title}\nGuía: ${shipment.trackingNumber ?? 'sin guía'}\nComprador: ${order.buyer_email}`)

  return NextResponse.json({
    shipmentId: shipmentRow?.id,
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

  // ── Fetch order ───────────────────────────────────────────────────────────
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

  const shopMeta     = (shop.metadata ?? {}) as Record<string, unknown>
  const shopSettings = (shopMeta.settings ?? {}) as Record<string, unknown>
  const originRaw    = shopSettings.origin_address as Record<string, string> | undefined
  const destRaw      = (order.shipping_address ?? {}) as Record<string, string>
  const listing      = order.marketplace_listings as unknown as { title: string }

  if (!originRaw?.postal_code) {
    return NextResponse.json({ error: 'Configura la dirección de origen en Ajustes.', code: 'MISSING_ORIGIN_ADDRESS' }, { status: 422 })
  }
  if (!destRaw.postal_code && !destRaw.postalCode) {
    return NextResponse.json({ error: 'El pedido no tiene dirección de entrega.', code: 'MISSING_SHIPPING_ADDRESS' }, { status: 422 })
  }

  const origin: EnviaAddress = {
    name: originRaw.name ?? shop.name,
    street: originRaw.street ?? '',
    city: originRaw.city ?? '',
    state: originRaw.state ?? '',
    postalCode: originRaw.postal_code,
  }
  const destination: EnviaAddress = {
    name: order.buyer_name ?? 'Comprador',
    street: destRaw.street ?? destRaw.line1 ?? '',
    city: destRaw.city ?? '',
    state: destRaw.state ?? '',
    postalCode: destRaw.postal_code ?? destRaw.postalCode ?? '',
  }

  try {
    const rates = await quoteShipments({
      origin,
      destination,
      packages: [{
        content: listing.title.slice(0, 80),
        weight: Math.max(0.1, weightGrams / 1000),
        dimensions: { length: lengthCm, width: widthCm, height: heightCm },
      }],
    })
    return NextResponse.json({ rates })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Error al cotizar: ${msg}` }, { status: 502 })
  }
}
