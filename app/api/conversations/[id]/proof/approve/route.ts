/**
 * POST /api/conversations/:id/proof/approve
 *
 * Buyer approves the seller's print proof (custom-print-products epic,
 * Sprint 4 · Story 4.1). Records the approval as a conversation event (so it
 * renders in chat) AND — when the conversation is linked to a real order
 * (`medusa_order_id`) — durably flips `proof_approved` on the Medusa order
 * itself, which is what both order screens and the transaction ledger read.
 * Advisory only: never gates shipping.
 *
 * Auth: Clerk JWT — must be the buyer on this conversation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { notify } from '@/lib/notify'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data: conv } = await db
    .from('marketplace_conversations')
    .select('id, buyer_clerk_user_id, seller_clerk_user_id, status, medusa_order_id')
    .eq('id', id)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 })
  if (conv.status !== 'active') return NextResponse.json({ error: 'Conversación cerrada.' }, { status: 409 })
  if (conv.buyer_clerk_user_id !== userId) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 })

  const now = new Date().toISOString()

  const [eventResult, convResult] = await Promise.all([
    db.from('marketplace_conversation_events').insert({
      conversation_id: id,
      event_type: 'proof_approved',
      actor: 'buyer',
      metadata: {},
    }),
    db.from('marketplace_conversations').update({
      last_event_at: now,
      updated_at: now,
      seller_unread: 1,
    }).eq('id', id),
  ])
  if (eventResult.error || convResult.error) {
    console.error('[proof/approve] write failed:', eventResult.error ?? convResult.error)
    return NextResponse.json({ error: 'No se pudo registrar la aprobación. Inténtalo de nuevo.' }, { status: 500 })
  }

  // Best-effort: flip the durable order flag so both order screens + the
  // ledger reflect it. A missing link (rare — e.g. the order-side write
  // failed at send time) never blocks the in-chat approval.
  if (conv.medusa_order_id) {
    try {
      const clerkJwt = await getToken()
      if (clerkJwt) {
        await fetch(`${MEDUSA_BASE}/store/buyer/me/orders/${conv.medusa_order_id}/proof-approve`, {
          method: 'POST',
          headers: {
            'x-publishable-api-key': MEDUSA_PUB_KEY,
            Authorization: `Bearer ${clerkJwt}`,
          },
        })
      }
    } catch {
      /* the in-chat approval already succeeded; order-flag sync is best-effort */
    }
  }

  try {
    await notify(conv.seller_clerk_user_id, {
      kind: 'new_message',
      title: 'Prueba aprobada',
      body: 'El comprador aprobó la prueba.',
      url: `/messages/${id}`,
      tag: `conv:${id}`,
    })
  } catch {
    /* push failures never break the approval */
  }

  return NextResponse.json({ ok: true })
}
