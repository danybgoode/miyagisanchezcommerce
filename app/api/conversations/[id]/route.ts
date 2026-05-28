import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getShopStripe } from '@/lib/stripe'

// ── GET — full conversation thread ────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Fetch conversation without offers embed (offers table has no currency column)
  const { data: conv } = await db
    .from('marketplace_conversations')
    .select(`
      id, status, buyer_clerk_user_id, seller_clerk_user_id, last_event_at,
      buyer_unread, seller_unread, offer_id,
      marketplace_listings ( id, title, price_cents, currency, images, status, condition, location, listing_type ),
      marketplace_shops ( id, name, slug, logo_url, metadata, mp_enabled )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 })

  const isBuyer  = conv.buyer_clerk_user_id === user.id
  const isSeller = conv.seller_clerk_user_id === user.id
  if (!isBuyer && !isSeller) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 })

  // Derive currency from listing
  const listingRaw = conv.marketplace_listings as unknown as Array<{ currency: string }> | { currency: string } | null
  const listingCurrency: string = Array.isArray(listingRaw)
    ? (listingRaw[0]?.currency ?? 'MXN')
    : (listingRaw?.currency ?? 'MXN')

  // Fetch offer + events in parallel
  const offerId = (conv as unknown as { offer_id: string | null }).offer_id

  const [eventsResult, offerResult] = await Promise.all([
    db.from('marketplace_conversation_events')
      .select('id, event_type, actor, metadata, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    offerId
      ? db.from('marketplace_offers')
          .select('id, status, offer_amount_cents, counter_amount_cents, counter_message, expires_at, counter_expires_at, checkout_expires_at')
          .eq('id', offerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const offerWithCurrency = offerResult.data
    ? { ...offerResult.data, currency: listingCurrency }
    : null

  const shopRaw = conv.marketplace_shops as unknown as {
    metadata?: Record<string, unknown> | null
    mp_enabled?: boolean | null
  } | null
  const stripeSettings = getShopStripe(shopRaw?.metadata ?? null)
  const sellerHasStripe = !!(stripeSettings.charges_enabled && stripeSettings.account_id && stripeSettings.enabled !== false)
  const sellerHasMp = (shopRaw?.mp_enabled ?? (shopRaw?.metadata?.mp_enabled as boolean | undefined)) !== false
  const checkoutProvider = sellerHasMp ? 'mercadopago' : sellerHasStripe ? 'stripe' : null

  // Mark unread as read for this user (fire-and-forget)
  const unreadField = isBuyer ? 'buyer_unread' : 'seller_unread'
  if ((isBuyer && conv.buyer_unread > 0) || (isSeller && conv.seller_unread > 0)) {
    db.from('marketplace_conversations').update({ [unreadField]: 0 }).eq('id', id).then(() => {})
  }

  return NextResponse.json({
    conversation: { ...conv, marketplace_offers: offerWithCurrency, checkout_provider: checkoutProvider },
    events: eventsResult.data ?? [],
    role: isBuyer ? 'buyer' : 'seller',
  })
}
