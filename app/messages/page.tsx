import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Mensajes — Miyagi Sánchez' }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 2)  return 'ahora'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d} d`
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

function lastEventSummary(eventType: string, actor: string, metadata: Record<string, unknown>) {
  const amt = metadata?.amount_cents ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: (metadata.currency as string) ?? 'MXN', maximumFractionDigits: 0 }).format((metadata.amount_cents as number) / 100) : ''
  switch (eventType) {
    case 'offer_sent':      return `Oferta enviada: ${amt}`
    case 'offer_countered': return `Contraoferta: ${amt}`
    case 'offer_accepted':  return '¡Oferta aceptada!'
    case 'offer_declined':  return 'Oferta rechazada'
    case 'offer_withdrawn': return 'Oferta retirada'
    case 'offer_expired':   return 'Oferta expirada'
    case 'purchase_complete': return '✓ Compra realizada'
    case 'shipped':         return '📦 Pedido enviado'
    case 'delivered':       return '✓ Entregado'
    case 'stamp_sent':      return (metadata?.text as string) ?? 'Mensaje'
    default:                return eventType
  }
}

export default async function MessagesPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in?redirect_url=/messages')

  const { data: convs } = await db
    .from('marketplace_conversations')
    .select(`
      id, status, last_event_at, buyer_unread, seller_unread,
      buyer_clerk_user_id, seller_clerk_user_id,
      marketplace_listings ( id, title, price_cents, currency, images ),
      marketplace_shops ( id, name, slug )
    `)
    .or(`buyer_clerk_user_id.eq.${user.id},seller_clerk_user_id.eq.${user.id}`)
    .in('status', ['active', 'completed'])
    .order('last_event_at', { ascending: false })
    .limit(100)

  const conversations = convs ?? []

  // Fetch last event for each conversation
  const convIds = conversations.map(c => c.id)
  type LastEventRow = { conversation_id: string; event_type: string; actor: string; metadata: unknown; created_at: string }
  const lastEvents: LastEventRow[] = []
  if (convIds.length > 0) {
    const { data } = await db
      .from('marketplace_conversation_events')
      .select('conversation_id, event_type, actor, metadata, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
    if (data) lastEvents.push(...(data as LastEventRow[]))
  }

  const lastEventMap = new Map<string, LastEventRow>()
  for (const ev of lastEvents ?? []) {
    if (!lastEventMap.has(ev.conversation_id)) lastEventMap.set(ev.conversation_id, ev)
  }

  const buying  = conversations.filter(c => c.buyer_clerk_user_id === user.id)
  const selling = conversations.filter(c => c.seller_clerk_user_id === user.id)
  const totalUnread = conversations.reduce((sum, c) => {
    const isBuyer = c.buyer_clerk_user_id === user.id
    return sum + (isBuyer ? c.buyer_unread : c.seller_unread)
  }, 0)

  function ConversationRow({ conv, role }: { conv: typeof conversations[0]; role: 'buyer' | 'seller' }) {
    const listing = conv.marketplace_listings as unknown as { id: string; title: string; price_cents: number | null; currency: string; images: Array<{ url: string }> | null } | null
    const shop    = conv.marketplace_shops as unknown as { name: string; slug: string } | null
    const lastEv  = lastEventMap.get(conv.id)
    const unread  = role === 'buyer' ? conv.buyer_unread : conv.seller_unread
    const otherParty = role === 'buyer' ? (shop?.name ?? 'Vendedor') : 'Comprador'

    return (
      <Link href={`/messages/${conv.id}`} className="no-underline block" style={{ borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        <div
          className="flex items-center gap-3 transition-colors"
          style={{
            padding: '14px 16px',
            background: unread > 0 ? 'var(--accent-soft)' : 'transparent',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Listing thumbnail */}
          <div style={{ width: 52, height: 52, borderRadius: 'var(--r-md)', overflow: 'hidden', flexShrink: 0, background: 'var(--bg-sunk)' }}>
            {listing?.images?.[0] ? (
              <img src={listing.images[0].url} alt={listing.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="iconoir-package" style={{ fontSize: 24, color: 'var(--fg-subtle)' }} />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span style={{ fontSize: 14, fontWeight: unread > 0 ? 700 : 500, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {otherParty}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)', flexShrink: 0 }}>{timeAgo(conv.last_event_at)}</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
              {listing?.title}
            </p>
            {lastEv && (
              <p style={{ fontSize: 12, color: unread > 0 ? 'var(--accent)' : 'var(--fg-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2, fontWeight: unread > 0 ? 600 : 400 }}>
                {lastEventSummary(lastEv.event_type, lastEv.actor, lastEv.metadata as Record<string, unknown>)}
              </p>
            )}
          </div>

          {unread > 0 && (
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{unread}</span>
            </div>
          )}
        </div>
      </Link>
    )
  }

  return (
    <div className="max-w-2xl mx-auto" style={{ paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <h1 style={{ fontWeight: 700, fontSize: 22 }}>Mensajes</h1>
          {totalUnread > 0 && (
            <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 'var(--r-pill)', padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
              {totalUnread}
            </span>
          )}
        </div>
      </div>

      {conversations.length === 0 ? (
        <div style={{ paddingTop: 80, textAlign: 'center', padding: '80px 24px' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-sunk)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <i className="iconoir-chat-bubble" style={{ fontSize: 28, color: 'var(--fg-subtle)' }} />
          </div>
          <p style={{ fontWeight: 600, fontSize: 17, marginBottom: 6 }}>Sin mensajes todavía</p>
          <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginBottom: 24 }}>
            Cuando hagas o recibas una oferta, la conversación aparecerá aquí.
          </p>
          <Link href="/l" className="btn btn-primary no-underline" style={{ display: 'inline-flex' }}>
            <i className="iconoir-search" style={{ fontSize: 16 }} />
            Explorar anuncios
          </Link>
        </div>
      ) : (
        <div>
          {/* Comprando section */}
          {buying.length > 0 && (
            <div>
              {selling.length > 0 && (
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 16px 4px' }}>
                  Comprando
                </p>
              )}
              {buying.map(conv => <ConversationRow key={conv.id} conv={conv} role="buyer" />)}
            </div>
          )}

          {/* Vendiendo section */}
          {selling.length > 0 && (
            <div>
              {buying.length > 0 && (
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '16px 16px 4px' }}>
                  Vendiendo
                </p>
              )}
              {selling.map(conv => <ConversationRow key={conv.id} conv={conv} role="seller" />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
