import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

// POST — mark a conversation as read for the current user.
// Decoupled from the GET so read-state isn't a polling side-effect.
// Called from ConversationClient on mount and on realtime reconnect.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data: conv } = await db
    .from('marketplace_conversations')
    .select('buyer_clerk_user_id, seller_clerk_user_id, buyer_unread, seller_unread')
    .eq('id', id)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 })

  const isBuyer  = conv.buyer_clerk_user_id === user.id
  const isSeller = conv.seller_clerk_user_id === user.id
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 })

  const field = isBuyer ? 'buyer_unread' : 'seller_unread'
  const current = isBuyer ? conv.buyer_unread : conv.seller_unread
  if ((current ?? 0) > 0) {
    await db.from('marketplace_conversations').update({ [field]: 0 }).eq('id', id)
  }

  return NextResponse.json({ ok: true })
}
