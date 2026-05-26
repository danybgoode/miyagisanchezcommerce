import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

// ── GET — inbox: all conversations for current user ───────────────────────────
// Returns conversations where user is buyer OR seller, sorted by most recent event.

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data } = await db
    .from('marketplace_conversations')
    .select(`
      id, status, last_event_at, buyer_unread, seller_unread,
      buyer_clerk_user_id, seller_clerk_user_id,
      marketplace_listings ( id, title, price_cents, currency, images, status ),
      marketplace_shops ( id, name, slug ),
      marketplace_offers ( id, status, offer_amount_cents, counter_amount_cents, currency )
    `)
    .or(`buyer_clerk_user_id.eq.${user.id},seller_clerk_user_id.eq.${user.id}`)
    .in('status', ['active', 'completed'])
    .order('last_event_at', { ascending: false })
    .limit(100)

  return NextResponse.json({ conversations: data ?? [] })
}
