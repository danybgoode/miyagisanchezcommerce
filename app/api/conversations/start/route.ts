import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { STAMPS, type StampKey } from '@/lib/stamps'
import { findOrCreateConversation } from '@/lib/conversations'

function isUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value)
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { listingId?: string; stampKey?: StampKey }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const listingId = body.listingId?.trim()
  if (!listingId) return NextResponse.json({ error: 'Anuncio no especificado.' }, { status: 400 })

  let query = db
    .from('marketplace_listings')
    .select('id, title, shop_id, marketplace_shops!inner(id, clerk_user_id)')
    .eq('medusa_product_id', listingId)
    .neq('status', 'deleted')
    .maybeSingle()

  let { data: listing, error } = await query

  if (!listing && !error && isUuid(listingId)) {
    const fallback = await db
      .from('marketplace_listings')
      .select('id, title, shop_id, marketplace_shops!inner(id, clerk_user_id)')
      .eq('id', listingId)
      .neq('status', 'deleted')
      .maybeSingle()
    listing = fallback.data
    error = fallback.error
  }

  if (error || !listing) return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })

  const shop = Array.isArray(listing.marketplace_shops)
    ? listing.marketplace_shops[0]
    : listing.marketplace_shops
  if (!shop?.clerk_user_id) return NextResponse.json({ error: 'Esta tienda todavía no puede recibir mensajes.' }, { status: 422 })
  if (shop.clerk_user_id === user.id) return NextResponse.json({ error: 'No puedes enviarte mensajes en tu propio anuncio.' }, { status: 422 })

  const stamp = STAMPS[body.stampKey ?? 'buyer_price_question'] ?? STAMPS.buyer_price_question

  const conversationId = await findOrCreateConversation({
    listingId: listing.id,
    shopId: listing.shop_id,
    buyerClerkUserId: user.id,
    sellerClerkUserId: shop.clerk_user_id,
  })
  if (!conversationId) {
    return NextResponse.json({ error: 'No se pudo abrir la conversación.' }, { status: 500 })
  }

  await Promise.all([
    db.from('marketplace_conversation_events').insert({
      conversation_id: conversationId,
      event_type: 'stamp_sent',
      actor: 'buyer',
      metadata: {
        stamp_key: body.stampKey ?? 'buyer_price_question',
        text: stamp.text,
        listing_title: listing.title,
      },
    }),
    db.from('marketplace_conversations').update({ seller_unread: 1 }).eq('id', conversationId),
  ])

  return NextResponse.json({ conversationId }, { status: 201 })
}
