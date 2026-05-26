import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import ConversationClient from './ConversationClient'
import Link from 'next/link'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { data: conv } = await db
    .from('marketplace_conversations')
    .select('marketplace_listings ( title )')
    .eq('id', id)
    .maybeSingle()
  const listing = (conv?.marketplace_listings as { title?: string } | null)
  return { title: listing?.title ? `${listing.title} — Mensajes` : 'Conversación — Miyagi Sánchez' }
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await currentUser()
  if (!user) redirect(`/sign-in?redirect_url=/messages/${id}`)

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

  if (!conv) notFound()

  const isBuyer  = conv.buyer_clerk_user_id === user.id
  const isSeller = conv.seller_clerk_user_id === user.id
  if (!isBuyer && !isSeller) notFound()

  const { data: events } = await db
    .from('marketplace_conversation_events')
    .select('id, event_type, actor, metadata, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  // Mark as read
  const unreadField = isBuyer ? 'buyer_unread' : 'seller_unread'
  await db.from('marketplace_conversations').update({ [unreadField]: 0 }).eq('id', id)

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
        initialConversation={conv as unknown as Parameters<typeof ConversationClient>[0]['initialConversation']}
        initialEvents={(events ?? []) as Parameters<typeof ConversationClient>[0]['initialEvents']}
        role={isBuyer ? 'buyer' : 'seller'}
        currentUserId={user.id}
      />
    </div>
  )
}
