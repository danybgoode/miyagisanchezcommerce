/**
 * POST /api/orders/[id]/return-request  — buyer opens a return request
 * GET  /api/orders/[id]/return-request  — get return request state for this order
 *
 * Routes to the Medusa backend for Medusa order IDs (order_*).
 * Sends emails via Resend after the backend creates the return record.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { sendReturnRequestToSeller, sendReturnRequestConfirmedToBuyer } from '@/lib/email'
import { tg, escapeHtml } from '@/lib/telegram'
import { db } from '@/lib/supabase'
import { dispatchToSeller, dispatchToBuyer } from '@/lib/notifications/dispatch'
import { buildBuyerMessage } from '@/lib/notifications/buyer-messages'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY    = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

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

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Medusa order
  if (id.startsWith('order_')) {
    const clerkJwt = await getToken()
    if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })
    const res = await medusaFetch(`/store/buyer/me/orders/${id}/return-request`, clerkJwt)
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.message ?? 'Error.' }, { status: res.status })
    return NextResponse.json({ request: data.return_request })
  }

  // Legacy Supabase fallback
  const { data: requests } = await db
    .from('marketplace_return_requests')
    .select('*')
    .eq('order_id', id)
    .order('created_at', { ascending: false })
  return NextResponse.json({ requests: requests ?? [] })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { reason?: string; description?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // ── Medusa path ───────────────────────────────────────────────────────────
  if (id.startsWith('order_')) {
    const clerkJwt = await getToken()
    if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

    const res = await medusaFetch(`/store/buyer/me/orders/${id}/return-request`, clerkJwt, {
      method: 'POST',
      body: JSON.stringify({ reason: body.reason, description: body.description }),
    })
    const data = await res.json() as { return_request?: Record<string, unknown>; message?: string }
    if (!res.ok) return NextResponse.json({ error: data.message ?? 'Error al crear la solicitud.' }, { status: res.status })

    const returnReq = data.return_request!
    const siteUrl   = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

    // Resolve seller for email notification
    try {
      const orderRes = await medusaFetch(`/store/buyer/me/orders/${id}`, clerkJwt)
      if (orderRes.ok) {
        const orderData = await orderRes.json() as { order?: { marketplace_shops?: { id?: string; name?: string; clerk_user_id?: string }; marketplace_listings?: { title?: string } } }
        const shop    = orderData.order?.marketplace_shops
        const listing = orderData.order?.marketplace_listings
        const listingTitle = listing?.title ?? 'Producto'
        const shopName     = shop?.name ?? 'Vendedor'

        if (shop?.clerk_user_id) {
          const orderUrl = `${siteUrl}/shop/manage/orders/${id}`
          const reason   = body.reason ?? ''
          // Seller notification through the preference seam (Devoluciones group):
          // email + push + linked Telegram, per the seller's prefs. The seam
          // resolves the seller email itself, only when the email channel is on.
          void dispatchToSeller(shop.clerk_user_id, {
            group: 'returns',
            email: (to) =>
              sendReturnRequestToSeller({
                sellerEmail:  to,
                shopName,
                buyerName:    null,
                buyerEmail:   (returnReq.buyer_email as string) ?? '',
                listingTitle,
                reason,
                description:  body.description?.trim() ?? null,
                orderUrl,
              }),
            push: { kind: 'order', title: 'Nueva solicitud de devolución', body: listingTitle, url: orderUrl },
            telegram:
              `↩️ <b>Nueva solicitud de devolución</b>\n${escapeHtml(listingTitle)}\n` +
              `Motivo: ${escapeHtml(reason)}\nRevísala en tu panel.`,
          })
        }
        // Buyer "Devoluciones" confirmation — the buyer initiated this (signed in).
        const reqMsg = buildBuyerMessage('return_requested', { listingTitle, url: `${siteUrl}/account/orders/${id}` })
        void dispatchToBuyer(
          { clerkUserId: userId, email: (returnReq.buyer_email as string) ?? '' },
          {
            group: 'buyer.devoluciones',
            email: to =>
              sendReturnRequestConfirmedToBuyer({
                buyerEmail: to,
                buyerName:  null,
                listingTitle,
                shopName,
                orderUrl: `${siteUrl}/account/orders/${id}`,
              }),
            push: reqMsg.push,
            telegram: reqMsg.telegram,
          },
        )

        tg.alert(`↩ Solicitud de devolución (Medusa)\n${listingTitle}\nMotivo: ${body.reason}`).catch(() => {})
      }
    } catch { /* non-fatal — emails best-effort */ }

    return NextResponse.json({ return_request: returnReq }, { status: 201 })
  }

  // ── Legacy Supabase path ──────────────────────────────────────────────────
  const VALID_REASONS = ['not_as_described', 'damaged', 'wrong_item', 'changed_mind', 'other']
  if (!body.reason || !VALID_REASONS.includes(body.reason)) {
    return NextResponse.json({ error: 'Motivo de devolución inválido.' }, { status: 422 })
  }

  const { data: order } = await db
    .from('marketplace_orders')
    .select('id, status, amount_cents, currency, buyer_email, buyer_name, buyer_clerk_user_id, shop_id, marketplace_listings!inner(id, title), marketplace_shops!inner(id, name, clerk_user_id)')
    .eq('id', id)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 })

  const shop    = order.marketplace_shops as unknown as { id: string; name: string; clerk_user_id: string | null }
  const listing = order.marketplace_listings as unknown as { id: string; title: string }
  const isBuyer = order.buyer_clerk_user_id === userId
  if (!isBuyer) return NextResponse.json({ error: 'Solo el comprador puede abrir una devolución.' }, { status: 403 })
  if (!['delivered', 'completed'].includes(order.status)) {
    return NextResponse.json({ error: 'Solo puedes solicitar una devolución después de recibir el pedido.' }, { status: 422 })
  }

  const { data: existing } = await db.from('marketplace_return_requests').select('id, status').eq('order_id', id).maybeSingle()
  if (existing && existing.status !== 'declined') {
    return NextResponse.json({ error: 'Ya existe una solicitud de devolución.', requestId: existing.id }, { status: 409 })
  }

  const { data: returnRequest, error: insertError } = await db
    .from('marketplace_return_requests')
    .insert({ order_id: id, shop_id: shop.id, buyer_clerk_user_id: userId, buyer_email: order.buyer_email, reason: body.reason, description: body.description?.trim() || null, status: 'pending' })
    .select('id').single()

  if (insertError || !returnRequest) return NextResponse.json({ error: 'Error al crear la solicitud.' }, { status: 500 })

  await db.from('marketplace_orders').update({ return_requested_at: new Date().toISOString() }).eq('id', id)

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  if (shop.clerk_user_id) {
    const orderUrl = `${siteUrl}/shop/manage/orders/${id}`
    const reason   = body.reason   // narrowed to a validated string by the guard above
    void dispatchToSeller(shop.clerk_user_id, {
      group: 'returns',
      email: (to) =>
        sendReturnRequestToSeller({ sellerEmail: to, shopName: shop.name, buyerName: order.buyer_name ?? null, buyerEmail: order.buyer_email ?? '', listingTitle: listing.title, reason, description: body.description?.trim() ?? null, orderUrl }),
      push: { kind: 'order', title: 'Nueva solicitud de devolución', body: listing.title, url: orderUrl },
      telegram:
        `↩️ <b>Nueva solicitud de devolución</b>\n${escapeHtml(listing.title)}\n` +
        `Motivo: ${escapeHtml(reason)}\nRevísala en tu panel.`,
    })
  }
  const reqMsg = buildBuyerMessage('return_requested', { listingTitle: listing.title, url: `${siteUrl}/account/orders/${id}` })
  void dispatchToBuyer(
    { clerkUserId: order.buyer_clerk_user_id ?? userId, email: order.buyer_email ?? '' },
    {
      group: 'buyer.devoluciones',
      email: to =>
        sendReturnRequestConfirmedToBuyer({ buyerEmail: to, buyerName: order.buyer_name ?? null, listingTitle: listing.title, shopName: shop.name, orderUrl: `${siteUrl}/account/orders/${id}` }),
      push: reqMsg.push,
      telegram: reqMsg.telegram,
    },
  )
  tg.alert(`↩ Solicitud de devolución\n${listing.title}\nMotivo: ${body.reason}`).catch(() => {})

  return NextResponse.json({ requestId: returnRequest.id }, { status: 201 })
}

// ── PATCH — buyer confirms receipt of an off-platform (SPEI/cash) refund ──────
// Closes the two-sided ladder: transferencia_pendiente → confirmado. Only the buyer
// can close it (the seller's "Ya transferí" is not enough). Medusa-only.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { action?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }
  if (body.action !== 'confirm_receipt') {
    return NextResponse.json({ error: 'Acción inválida.' }, { status: 422 })
  }
  // The off-platform ladder lives on the Medusa order metadata — legacy orders never
  // reach the buyer-confirm step.
  if (!id.startsWith('order_')) {
    return NextResponse.json({ error: 'Esta acción solo está disponible para pedidos recientes.' }, { status: 422 })
  }

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'Error de autenticación.' }, { status: 401 })

  const res = await medusaFetch(`/store/buyer/me/orders/${id}/return-request`, clerkJwt, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'confirm_receipt' }),
  })
  const data = await res.json() as { refund_state?: string; message?: string }
  if (!res.ok) return NextResponse.json({ error: data.message ?? 'Error al confirmar el reembolso.' }, { status: res.status })

  // Notify the seller that the buyer confirmed receipt — the refund is now closed
  // (best-effort, via the seller's Devoluciones preferences).
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
    const orderRes = await medusaFetch(`/store/buyer/me/orders/${id}`, clerkJwt)
    if (orderRes.ok) {
      const orderData = await orderRes.json() as { order?: { marketplace_shops?: { clerk_user_id?: string }; marketplace_listings?: { title?: string } } }
      const shop = orderData.order?.marketplace_shops
      const listingTitle = orderData.order?.marketplace_listings?.title ?? 'Producto'
      if (shop?.clerk_user_id) {
        const orderUrl = `${siteUrl}/shop/manage/orders/${id}`
        void dispatchToSeller(shop.clerk_user_id, {
          group: 'returns',
          push: { kind: 'order', title: 'Reembolso confirmado por el comprador', body: listingTitle, url: orderUrl },
          telegram: `✅ <b>Reembolso confirmado por el comprador</b>\n${escapeHtml(listingTitle)}\nLa devolución quedó cerrada.`,
        })
      }
      tg.alert(`✅ Reembolso confirmado por el comprador (Medusa)\n${listingTitle}`).catch(() => {})
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({ refund_state: data.refund_state ?? 'confirmado' })
}
