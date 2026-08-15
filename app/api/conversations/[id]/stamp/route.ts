import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { STAMPS, type StampKey } from '@/lib/stamps'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { listingTitleForConversation, notifyConversationMessage } from '@/lib/notifications/conversation'

// ── POST — send a structured stamp message ────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const rl = await checkRateLimit('stamps', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Demasiados mensajes. Inténtalo en un momento.' }, { status: 429 })
  }

  const body = await req.json() as { stampKey?: string }
  if (!body.stampKey || !(body.stampKey in STAMPS)) {
    return NextResponse.json({ error: 'Stamp inválido.' }, { status: 400 })
  }

  const { data: conv } = await db
    .from('marketplace_conversations')
    .select('id, buyer_clerk_user_id, seller_clerk_user_id, status, buyer_unread, seller_unread')
    .eq('id', id)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 })
  if (conv.status !== 'active') return NextResponse.json({ error: 'Conversación cerrada.' }, { status: 409 })

  const isBuyer  = conv.buyer_clerk_user_id === user.id
  const isSeller = conv.seller_clerk_user_id === user.id
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 })

  const stampKey = body.stampKey as StampKey
  const stamp = STAMPS[stampKey]

  // Validate the stamp is available for this role
  if ((stamp.role as string) !== 'both' && stamp.role !== (isBuyer ? 'buyer' : 'seller')) {
    return NextResponse.json({ error: 'Stamp no disponible para este rol.' }, { status: 403 })
  }

  const actor = isBuyer ? 'buyer' : 'seller'
  const counterField = isBuyer ? 'seller_unread' : 'buyer_unread'

  const currentCount = (conv[counterField as 'buyer_unread' | 'seller_unread'] ?? 0) + 1

  await Promise.all([
    db.from('marketplace_conversation_events').insert({
      conversation_id: id,
      event_type: 'stamp_sent',
      actor,
      metadata: { stamp_key: stampKey, text: stamp.text },
    }),
    db.from('marketplace_conversations').update({
      last_event_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      [counterField]: currentCount,
    }).eq('id', id),
  ])

  // Tell the other party — through the PREFERENCE SEAM, not raw web push.
  //
  // This used to call `notify()` directly, so a reply reached exactly the people who
  // had granted a push subscription and nobody else. Most sellers have none, which
  // made messaging look delivered while being silent. Email + push + Telegram now,
  // per the recipient's own settings. Never blocks the send.
  const recipientId = isBuyer ? conv.seller_clerk_user_id : conv.buyer_clerk_user_id
  void notifyConversationMessage({
    conversationId: id,
    recipientClerkUserId: recipientId ?? null,
    recipientRole: isBuyer ? 'seller' : 'buyer',
    listingTitle: await listingTitleForConversation(id),
    messageText: stamp.text,
  })

  return NextResponse.json({ ok: true })
}
