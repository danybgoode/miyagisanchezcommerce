import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

// Lightweight endpoint: total unread count for the current user.
// Called by MobileTabBar and DesktopUnreadBadge every ~20s.

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ unread: 0 })

  const { data } = await db
    .from('marketplace_conversations')
    .select('buyer_unread, seller_unread, buyer_clerk_user_id, seller_clerk_user_id')
    .or(`buyer_clerk_user_id.eq.${user.id},seller_clerk_user_id.eq.${user.id}`)
    .in('status', ['active', 'completed'])
    .limit(100)

  const unread = (data ?? []).reduce((sum, conv) => {
    const isBuyer = conv.buyer_clerk_user_id === user.id
    return sum + (isBuyer ? (conv.buyer_unread ?? 0) : (conv.seller_unread ?? 0))
  }, 0)

  return NextResponse.json({ unread })
}
