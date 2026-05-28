import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { STAMPS, type StampKey } from '@/lib/stamps'

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
  const now = new Date().toISOString()

  const { data: conv, error: convError } = await db
    .from('marketplace_conversations')
    .upsert({
      listing_id: listing.id,
      shop_id: listing.shop_id,
      buyer_clerk_user_id: user.id,
      seller_clerk_user_id: shop.clerk_user_id,
      seller_unread: 1,
      last_event_at: now,
      updated_at: now,
    }, { onConflict: 'buyer_clerk_user_id,listing_id' })
    .select('id')
    .single()

  if (convError || !conv) {
    console.error('[conversations/start] upsert failed:', convError)
    return NextResponse.json({ error: 'No se pudo abrir la conversación.' }, { status: 500 })
  }

  await db.from('marketplace_conversation_events').insert({
    conversation_id: conv.id,
    event_type: 'stamp_sent',
    actor: 'buyer',
    metadata: {
      stamp_key: body.stampKey ?? 'buyer_price_question',
      text: stamp.text,
      listing_title: listing.title,
    },
  })

  return NextResponse.json({ conversationId: conv.id }, { status: 201 })
}
