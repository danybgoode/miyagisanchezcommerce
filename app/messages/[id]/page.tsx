import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import ConversationClient from './ConversationClient'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getShopStripe } from '@/lib/stripe'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { data: conv } = await db
    .from('marketplace_conversations')
    .select('marketplace_listings ( title )')
    .eq('id', id)
    .maybeSingle()
  const listing = (conv?.marketplace_listings as unknown as { title?: string } | null)
  return { title: listing?.title ? `${listing.title} — Mensajes` : 'Conversación — Miyagi Sánchez' }
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await currentUser()
  if (!user) redirect(`/sign-in?redirect_url=/messages/${id}`)

  // ── Fetch conversation (no offers embed — offers table has no currency column) ──
  const { data: conv } = await db
    .from('marketplace_conversations')
    .select(`
      id, status, buyer_clerk_user_id, seller_clerk_user_id, last_event_at,
      buyer_unread, seller_unread, offer_id,
      marketplace_listings ( id, medusa_product_id, title, price_cents, currency, images, status, condition, location, listing_type ),
      marketplace_shops ( id, name, slug, logo_url, metadata, mp_enabled )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!conv) notFound()

  const isBuyer  = conv.buyer_clerk_user_id === user.id
  const isSeller = conv.seller_clerk_user_id === user.id
  if (!isBuyer && !isSeller) notFound()

  // ── Derive currency from listing (offers table has no currency column) ──────
  const listingRaw = conv.marketplace_listings as unknown as Array<{ currency: string }> | { currency: string } | null
  const listingCurrency: string = Array.isArray(listingRaw)
    ? (listingRaw[0]?.currency ?? 'MXN')
    : (listingRaw?.currency ?? 'MXN')

  // ── Fetch offer + events in parallel ─────────────────────────────────────────
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

  // Attach currency (from listing) to the offer object for the client
  const offerWithCurrency = offerResult.data
    ? { ...offerResult.data, currency: listingCurrency }
    : null

  const shopRaw = conv.marketplace_shops as unknown as {
    metadata?: Record<string, unknown> | null
    mp_enabled?: boolean | null
  } | null
  const stripeSettings = getShopStripe(shopRaw?.metadata ?? null)
  const sellerHasStripe = !!(stripeSettings.charges_enabled && stripeSettings.account_id && stripeSettings.enabled !== false)
  const sellerHasMp = sellerHasMpConnected(shopRaw?.metadata ?? null)
  const checkoutProvider = sellerHasMp ? 'mercadopago' : sellerHasStripe ? 'stripe' : null

  // Mark as read (fire-and-forget, non-blocking)
  const unreadField = isBuyer ? 'buyer_unread' : 'seller_unread'
  db.from('marketplace_conversations').update({ [unreadField]: 0 }).eq('id', id).then(() => {})

  type ConvParam = Parameters<typeof ConversationClient>[0]['initialConversation']
  const initialConversation: ConvParam = {
    ...(conv as unknown as ConvParam),
    marketplace_offers: offerWithCurrency as ConvParam['marketplace_offers'],
    checkout_provider: checkoutProvider,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 72px)' }}>
      {/* Back nav */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elevated)', flexShrink: 0 }}>
        <Link href="/messages" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">
          <i className="iconoir-arrow-left" style={{ fontSize: 18 }} />
          Mensajes
        </Link>
      </div>

      <ConversationClient
        conversationId={id}
        initialConversation={initialConversation}
        initialEvents={(eventsResult.data ?? []) as Parameters<typeof ConversationClient>[0]['initialEvents']}
        role={isBuyer ? 'buyer' : 'seller'}
        currentUserId={user.id}
        currentUserEmail={user.emailAddresses[0]?.emailAddress ?? ''}
      />
    </div>
  )
}
