import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

// ── GET — full conversation thread ────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Fetch conversation (must belong to this user)
  const { data: conv } = await db
    .from('marketplace_conversations')
    .select(`
      id, status, buyer_clerk_user_id, seller_clerk_user_id, last_event_at,
      buyer_unread, seller_unread,
      marketplace_listings ( id, title, price_cents, currency, images, status, condition, location ),
      marketplace_shops ( id, name, slug, logo_url ),
      marketplace_offers ( id, status, offer_amount_cents, counter_amount_cents, counter_message, expires_at, counter_expires_at, checkout_expires_at, currency )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 })

  const isBuyer  = conv.buyer_clerk_user_id === user.id
  const isSeller = conv.seller_clerk_user_id === user.id
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 })

  // Fetch events
  const { data: events } = await db
    .from('marketplace_conversation_events')
    .select('id, event_type, actor, metadata, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  // Mark unread as read for this user
  const unreadField = isBuyer ? 'buyer_unread' : 'seller_unread'
  if ((isBuyer && conv.buyer_unread > 0) || (isSeller && conv.seller_unread > 0)) {
    await db.from('marketplace_conversations').update({ [unreadField]: 0 }).eq('id', id)
  }

  return NextResponse.json({
    conversation: conv,
    events: events ?? [],
    role: isBuyer ? 'buyer' : 'seller',
  })
}
