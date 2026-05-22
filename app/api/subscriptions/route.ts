/**
 * GET /api/subscriptions
 * Returns buyer's active subscriptions + available content for each.
 * Requires Clerk auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const clerkUser = await currentUser()
  if (!clerkUser) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email') ?? clerkUser.emailAddresses?.[0]?.emailAddress

  // Fetch subscriptions by clerk user ID or email
  const { data: subscriptions, error } = await db
    .from('marketplace_subscriptions')
    .select(`
      id, listing_id, shop_id, status, payment_method,
      current_period_start, current_period_end, cancel_at_period_end, created_at,
      marketplace_listings!inner(id, title, price_cents, currency, images, metadata),
      marketplace_shops!inner(id, name, slug)
    `)
    .or(
      clerkUser.id
        ? `buyer_clerk_user_id.eq.${clerkUser.id},buyer_email.ilike.${email}`
        : `buyer_email.ilike.${email}`,
    )
    .in('status', ['active', 'trialing', 'past_due', 'pending_confirmation'])
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[subscriptions GET]', error)
    return NextResponse.json({ error: 'Error al obtener suscripciones.' }, { status: 500 })
  }

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ subscriptions: [] })
  }

  // Fetch content for each active subscription
  const activeShopIds = [...new Set(
    subscriptions
      .filter(s => s.status === 'active' || s.status === 'trialing')
      .map(s => s.shop_id),
  )]

  const { data: content } = activeShopIds.length > 0
    ? await db
        .from('marketplace_subscription_content')
        .select('id, shop_id, listing_id, title, body, file_url, file_type, created_at')
        .in('shop_id', activeShopIds)
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] }

  return NextResponse.json({ subscriptions, content: content ?? [] })
}
