/**
 * POST /api/orders/:id/proof
 *
 * Seller sends a print proof from the order screen into the buyer-seller
 * conversation (custom-print-products epic, Sprint 4 · Story 4.1). Most
 * configurator purchases are buy-now (no negotiation), so there's usually no
 * conversation yet — this route finds or creates one, links it to the real
 * order (`medusa_order_id`, so the transaction ledger can resolve state with
 * no offer in the picture), and mirrors the durable order-metadata write
 * (`POST /store/sellers/me/orders/:id/proof`, which derives the restated
 * size/quantity/price from the order itself — never trusted from here) as a
 * conversation event so the buyer sees it in chat.
 *
 * Auth: Clerk JWT — must be the seller who owns the order (enforced by the
 * backend route this proxies to).
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { findOrCreateConversation } from '@/lib/conversations'
import { resolveClerkUserIdByEmail } from '@/lib/clerk-lookup'
import { notify } from '@/lib/notify'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params
  const { userId: sellerClerkUserId, getToken } = await auth()
  if (!sellerClerkUserId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const clerkJwt = await getToken()
  if (!clerkJwt) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { imageUrl?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : ''
  if (!imageUrl) return NextResponse.json({ error: 'Falta la imagen de la prueba.' }, { status: 400 })

  const authHeaders = {
    'x-publishable-api-key': MEDUSA_PUB_KEY,
    Authorization: `Bearer ${clerkJwt}`,
  }

  // 1. Read the order for buyer email + the medusa product id (ownership is
  // enforced by this same backend route, so a 403/404 here surfaces cleanly).
  const orderRes = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${orderId}`, {
    headers: authHeaders,
    cache: 'no-store',
  })
  if (!orderRes.ok) {
    return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: orderRes.status === 401 ? 401 : 404 })
  }
  const { order } = await orderRes.json() as {
    order?: { buyer_email?: string | null; marketplace_listings?: { id?: string } | null }
  }
  const buyerEmail = order?.buyer_email ?? ''
  const medusaProductId = order?.marketplace_listings?.id ?? ''
  if (!buyerEmail || !medusaProductId) {
    return NextResponse.json({ error: 'No se pudo leer el comprador o el producto de este pedido.' }, { status: 422 })
  }

  // 2. Write the durable, server-derived restatement onto the Medusa order —
  // the ONLY source of truth for size/quantity/price shown to the buyer.
  const proofRes = await fetch(`${MEDUSA_BASE}/store/sellers/me/orders/${orderId}/proof`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!proofRes.ok) {
    const err = await proofRes.json().catch(() => null) as { message?: string } | null
    return NextResponse.json({ error: err?.message ?? 'No se pudo registrar la prueba.' }, { status: proofRes.status })
  }
  const proof = await proofRes.json() as {
    proof_sent_at: string; proof_image_url: string; proof_size: string
    proof_quantity: number; proof_price_cents: number
  }

  // 3. Resolve the Supabase listing (for the conversation's listing_id/shop_id)
  // and the buyer's Clerk id (a Medusa order only carries email).
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, shop_id, marketplace_shops!inner(clerk_user_id)')
    .eq('medusa_product_id', medusaProductId)
    .maybeSingle()

  if (!listing) {
    return NextResponse.json({ error: 'Anuncio no encontrado para este pedido.' }, { status: 422 })
  }
  const shop = Array.isArray(listing.marketplace_shops) ? listing.marketplace_shops[0] : listing.marketplace_shops

  const buyerClerkUserId = await resolveClerkUserIdByEmail(buyerEmail)
  if (!buyerClerkUserId) {
    // The order-metadata write above already succeeded — the buyer will see
    // "Prueba enviada" on their order page even if we can't reach them in
    // chat. Not fatal, but worth a clear message so the seller knows why no
    // conversation opened.
    return NextResponse.json({
      ok: true,
      conversationId: null,
      warning: 'La prueba quedó registrada en el pedido, pero no se pudo abrir el chat con el comprador.',
    })
  }

  const conversationId = await findOrCreateConversation({
    listingId: listing.id,
    shopId: listing.shop_id,
    buyerClerkUserId,
    sellerClerkUserId,
    medusaOrderId: orderId,
  })
  if (!conversationId) {
    return NextResponse.json({
      ok: true,
      conversationId: null,
      warning: 'La prueba quedó registrada en el pedido, pero no se pudo abrir el chat con el comprador.',
    })
  }

  await Promise.all([
    db.from('marketplace_conversation_events').insert({
      conversation_id: conversationId,
      event_type: 'proof_sent',
      actor: 'seller',
      metadata: {
        image_url: proof.proof_image_url,
        size: proof.proof_size,
        quantity: proof.proof_quantity,
        price_cents: proof.proof_price_cents,
      },
    }),
    db.from('marketplace_conversations').update({
      last_event_at: proof.proof_sent_at,
      updated_at: proof.proof_sent_at,
      buyer_unread: 1,
    }).eq('id', conversationId),
  ])

  try {
    await notify(buyerClerkUserId, {
      kind: 'new_message',
      title: 'Prueba de impresión',
      body: 'El vendedor envió una prueba para tu aprobación.',
      url: `/messages/${conversationId}`,
      tag: `conv:${conversationId}`,
    })
  } catch {
    /* push failures never break the send */
  }

  return NextResponse.json({ ok: true, conversationId })
}
