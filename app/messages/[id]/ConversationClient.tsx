'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { BUYER_STAMPS, SELLER_STAMPS, type StampKey } from '@/lib/stamps'
import { formatOfferAmount, timeUntil } from '@/lib/offers'
import OfferCheckoutButton from '@/app/components/OfferCheckoutButton'
import type { CheckoutProvider } from '@/lib/cart'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConvListing {
  id: string; title: string; price_cents: number | null; currency: string
  images: Array<{ url: string }> | null; status: string; condition: string | null; location: string | null
  listing_type?: string | null
}
interface ConvShop { id: string; name: string; slug: string; logo_url?: string | null }
interface ConvOffer {
  id: string; status: string; offer_amount_cents: number; counter_amount_cents: number | null
  counter_message: string | null; expires_at: string; counter_expires_at: string | null
  checkout_expires_at: string | null; currency: string
}
interface ConvEvent {
  id: string; event_type: string; actor: string
  metadata: Record<string, unknown>; created_at: string
}
interface Conversation {
  id: string; status: string; buyer_clerk_user_id: string; seller_clerk_user_id: string
  last_event_at: string; buyer_unread: number; seller_unread: number
  marketplace_listings: ConvListing | null
  marketplace_shops: ConvShop | null
  marketplace_offers: ConvOffer | null
  checkout_provider?: CheckoutProvider | null
}

interface Props {
  conversationId: string
  initialConversation: Conversation
  initialEvents: ConvEvent[]
  role: 'buyer' | 'seller'
  currentUserId: string
  currentUserEmail?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
}
function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}
function fmt(cents: number, currency = 'MXN') {
  return formatOfferAmount(cents, currency)
}

function listingTypeLabel(type?: string | null) {
  switch (type) {
    case 'digital': return 'Digital'
    case 'service': return 'Servicio'
    case 'rental': return 'Renta'
    case 'subscription': return 'Suscripción'
    default: return 'Producto'
  }
}

function listingStatusLabel(status?: string | null) {
  switch (status) {
    case 'sold': return 'Vendido'
    case 'paused': return 'Pausado'
    case 'draft': return 'Borrador'
    case 'active': return 'Activo'
    default: return status ?? 'Anuncio'
  }
}

// ── Event renderer ────────────────────────────────────────────────────────────

function EventBubble({ event, role }: { event: ConvEvent; role: 'buyer' | 'seller' }) {
  const meta = event.metadata
  const isMine = event.actor === role || (event.actor === `${role}_agent`)
  const isSystem = event.actor === 'system'
  const currency = (meta.currency as string) ?? 'MXN'

  if (isSystem) {
    return (
      <div style={{ textAlign: 'center', padding: '6px 16px' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', background: 'var(--bg-sunk)', borderRadius: 'var(--r-pill)', padding: '4px 12px', display: 'inline-block' }}>
          {renderSystemText(event.event_type, meta, currency)}
        </span>
      </div>
    )
  }

  // Offer events get special treatment
  if (event.event_type === 'offer_sent') {
    return (
      <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', padding: '4px 16px' }}>
        <div style={{
          maxWidth: '75%', borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '12px 16px',
          background: isMine ? 'var(--accent)' : 'var(--bg-elevated)',
          border: isMine ? 'none' : '1px solid var(--border)',
          boxShadow: 'var(--shadow-1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: isMine ? 'rgba(255,255,255,0.7)' : 'var(--fg-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Oferta</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: isMine ? '#fff' : 'var(--fg)' }}>
            {fmt(meta.amount_cents as number, currency)}
          </div>
          <div style={{ fontSize: 11, color: isMine ? 'rgba(255,255,255,0.6)' : 'var(--fg-subtle)', marginTop: 2 }}>{formatTime(event.created_at)}</div>
        </div>
      </div>
    )
  }

  if (event.event_type === 'offer_countered') {
    return (
      <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', padding: '4px 16px' }}>
        <div style={{
          maxWidth: '75%', borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '12px 16px',
          background: isMine ? 'var(--info)' : 'var(--info-soft)',
          border: isMine ? 'none' : '1.5px solid var(--info)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: isMine ? 'rgba(255,255,255,0.7)' : 'var(--info)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contraoferta</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: isMine ? '#fff' : 'var(--info)' }}>
            {fmt(meta.counter_amount_cents as number ?? meta.amount_cents as number, currency)}
          </div>
          {typeof meta.message === 'string' && meta.message && <div style={{ fontSize: 13, color: isMine ? 'rgba(255,255,255,0.85)' : 'var(--info)', marginTop: 6, fontStyle: 'italic' }}>&ldquo;{meta.message}&rdquo;</div>}
          <div style={{ fontSize: 11, color: isMine ? 'rgba(255,255,255,0.6)' : 'var(--fg-subtle)', marginTop: 4 }}>{formatTime(event.created_at)}</div>
        </div>
      </div>
    )
  }

  if (event.event_type === 'stamp_sent') {
    return (
      <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', padding: '3px 16px' }}>
        <div style={{
          maxWidth: '80%', borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          padding: '9px 14px',
          background: isMine ? 'var(--fg)' : 'var(--bg-elevated)',
          border: isMine ? 'none' : '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 14, color: isMine ? '#fff' : 'var(--fg)', lineHeight: 1.4 }}>{meta.text as string}</span>
          <div style={{ fontSize: 10, color: isMine ? 'rgba(255,255,255,0.5)' : 'var(--fg-subtle)', marginTop: 3, textAlign: 'right' }}>{formatTime(event.created_at)}</div>
        </div>
      </div>
    )
  }

  return null
}

function renderSystemText(type: string, meta: Record<string, unknown>, currency: string): string {
  const amt = meta.amount_cents ? fmt(meta.amount_cents as number, currency) : ''
  switch (type) {
    case 'offer_accepted':   return `✓ Oferta aceptada — ${amt}`
    case 'offer_declined':   return 'Oferta rechazada'
    case 'offer_withdrawn':  return 'Oferta retirada'
    case 'offer_expired':    return 'Oferta expirada sin respuesta'
    case 'purchase_complete':return '✓ Compra realizada'
    case 'shipped':          return `📦 Pedido enviado${meta.tracking ? ` · ${meta.tracking}` : ''}`
    case 'delivered':        return '✓ Entregado'
    case 'feedback_left':    return '⭐ Calificación enviada'
    default:                 return type
  }
}

// ── Offer action bar ──────────────────────────────────────────────────────────

function OfferActionBar({
  offer, role, listing, checkoutProvider, isSignedIn, onRefresh,
}: {
  offer: ConvOffer
  role: 'buyer' | 'seller'
  listing: ConvListing | null
  checkoutProvider?: CheckoutProvider | null
  isSignedIn: boolean
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function sellerAction(action: 'accept' | 'decline' | 'counter', counterCents?: number, msg?: string) {
    setBusy(true)
    try {
      await fetch(`/api/offers/${offer.id}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, counterAmountCents: counterCents, counterMessage: msg }),
      })
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  async function buyerAction(action: 'accept-counter' | 'withdraw') {
    setBusy(true)
    try {
      await fetch(`/api/offers/${offer.id}/buyer-respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const isExpiredOffer = new Date(offer.expires_at) < new Date()
  const isExpiredCounter = offer.counter_expires_at && new Date(offer.counter_expires_at) < new Date()
  const isCheckoutExpired = offer.checkout_expires_at && new Date(offer.checkout_expires_at) < new Date()
  const agreedCents = offer.counter_amount_cents ?? offer.offer_amount_cents

  if (offer.status === 'paid') {
    return (
      <DealStatusBar
        tone="success"
        title="Compra realizada"
        body={`El pedido quedó confirmado por ${fmt(agreedCents, offer.currency)}.`}
      />
    )
  }

  if (offer.status === 'declined') {
    return <DealStatusBar tone="neutral" title="Oferta rechazada" body="El artículo sigue disponible si quieres iniciar una nueva conversación u oferta." />
  }

  if (offer.status === 'withdrawn') {
    return <DealStatusBar tone="neutral" title="Oferta retirada" body="Esta negociación ya no está activa." />
  }

  if (offer.status === 'expired' || isExpiredOffer || isExpiredCounter || isCheckoutExpired) {
    return <DealStatusBar tone="danger" title="Trato expirado" body="El precio acordado ya no está disponible. Puedes volver al anuncio para iniciar una nueva oferta." />
  }

  if (role === 'seller' && offer.status === 'pending' && !isExpiredOffer) {
    return <SellerActionBar offer={offer} onAction={sellerAction} busy={busy} />
  }

  if (role === 'buyer' && offer.status === 'pending' && !isExpiredOffer) {
    return (
      <div style={{ padding: '8px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          onClick={() => buyerAction('withdraw')}
          disabled={busy}
          style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Retirar oferta
        </button>
        {offer.expires_at && (
          <span style={{ fontSize: 11, color: 'var(--fg-subtle)', marginLeft: 12 }}>
            Expira en {timeUntil(offer.expires_at)}
          </span>
        )}
      </div>
    )
  }

  if (role === 'buyer' && offer.status === 'countered' && !isExpiredCounter) {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => buyerAction('accept-counter')}
          disabled={busy}
          className="flex-1 font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          ✓ Aceptar trato
        </button>
        <button
          type="button"
          onClick={() => buyerAction('withdraw')}
          disabled={busy}
          className="flex-1 font-medium rounded-xl py-3 text-sm disabled:opacity-50"
          style={{ background: 'var(--bg-sunk)', color: 'var(--fg)', border: '1px solid var(--border)', cursor: 'pointer' }}
        >
          Rechazar
        </button>
      </div>
    )
  }

  if (role === 'buyer' && offer.status === 'accepted') {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--success-soft)', borderTop: '1.5px solid var(--success)' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>¡Trato listo! Compra al precio acordado.</p>
        <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--fg)', marginBottom: 8 }}>{fmt(agreedCents, offer.currency)}</p>
        {offer.checkout_expires_at && (
          <p style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 8 }}>⏰ Expira en {timeUntil(offer.checkout_expires_at)}</p>
        )}
        {listing && checkoutProvider ? (
          <OfferCheckoutButton
            listingId={listing.id}
            offerId={offer.id}
            amountCents={agreedCents}
            currency={offer.currency}
            provider={checkoutProvider}
            isSignedIn={isSignedIn}
            label="Comprar ahora"
            variant="accent"
          />
        ) : (
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>El vendedor aún no tiene pagos en línea activos. Escríbele para coordinar.</p>
        )}
      </div>
    )
  }

  if (role === 'seller' && offer.status === 'accepted') {
    return (
      <DealStatusBar
        tone="success"
        title="Trato aceptado"
        body={`Esperando pago del comprador por ${fmt(agreedCents, offer.currency)}.`}
      />
    )
  }

  return null
}

function DealStatusBar({ tone, title, body }: {
  tone: 'success' | 'danger' | 'neutral'
  title: string
  body: string
}) {
  const styles = {
    success: { bg: 'var(--success-soft)', border: 'var(--success)', color: 'var(--success)' },
    danger: { bg: 'var(--danger-soft)', border: 'var(--danger)', color: 'var(--danger)' },
    neutral: { bg: 'var(--bg-elevated)', border: 'var(--border)', color: 'var(--fg)' },
  }[tone]

  return (
    <div style={{ padding: '12px 16px', background: styles.bg, borderTop: `1.5px solid ${styles.border}` }}>
      <p style={{ fontSize: 13, fontWeight: 800, color: styles.color, marginBottom: 3 }}>{title}</p>
      <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{body}</p>
    </div>
  )
}

function SellerActionBar({ offer, onAction, busy }: {
  offer: ConvOffer
  onAction: (action: 'accept' | 'decline' | 'counter', cents?: number, msg?: string) => void
  busy: boolean
}) {
  const [showCounter, setShowCounter] = useState(false)
  const [counterVal, setCounterVal] = useState('')
  const [counterMsg, setCounterMsg] = useState('')
  const asking = offer.offer_amount_cents
  const suggested = Math.round((asking + (offer.offer_amount_cents * 100 / 85)) / 2) // midpoint suggestion

  if (showCounter) {
    const cents = Math.round(parseFloat(counterVal) * 100) || 0
    return (
      <div style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Tu contraoferta</span>
          <button type="button" onClick={() => setShowCounter(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: 18 }}>×</button>
        </div>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--fg-muted)' }}>$</span>
          <input
            type="number"
            inputMode="numeric"
            value={counterVal}
            onChange={e => setCounterVal(e.target.value)}
            placeholder={String(suggested / 100)}
            style={{ width: '100%', border: '1.5px solid var(--border)', borderRadius: 'var(--r-md)', paddingLeft: 28, paddingRight: 12, paddingTop: 10, paddingBottom: 10, fontSize: 16, fontFamily: 'var(--font-sans)', background: 'var(--bg-elevated)', outline: 'none', boxSizing: 'border-box' }}
            className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <input
          type="text"
          value={counterMsg}
          onChange={e => setCounterMsg(e.target.value)}
          placeholder="Nota opcional para el comprador…"
          style={{ width: '100%', border: '1.5px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-sans)', background: 'var(--bg-elevated)', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
        />
        <button
          type="button"
          onClick={() => onAction('counter', cents, counterMsg || undefined)}
          disabled={busy || cents <= 0}
          className="w-full font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
          style={{ background: 'var(--info)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14 }}
        >
          Enviar contraoferta — {cents > 0 ? fmt(cents, offer.currency) : '…'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
      <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 10 }}>
        Oferta recibida: <strong>{fmt(offer.offer_amount_cents, offer.currency)}</strong>
        {offer.expires_at && <span style={{ marginLeft: 8 }}>· Expira en {timeUntil(offer.expires_at)}</span>}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => onAction('accept')}
          disabled={busy}
          className="flex-1 font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          ✓ Aceptar
        </button>
        <button
          type="button"
          onClick={() => setShowCounter(true)}
          disabled={busy}
          className="font-medium rounded-xl py-3 text-sm disabled:opacity-50"
          style={{ background: 'var(--info-soft)', color: 'var(--info)', border: '1.5px solid var(--info)', cursor: 'pointer', padding: '12px 16px' }}
        >
          ↩ Contraofertar
        </button>
        <button
          type="button"
          onClick={() => onAction('decline')}
          disabled={busy}
          className="font-medium rounded-xl py-3 text-sm disabled:opacity-50"
          style={{ background: 'var(--bg-sunk)', color: 'var(--fg-muted)', border: '1px solid var(--border)', cursor: 'pointer', padding: '12px 16px' }}
        >
          ✗
        </button>
      </div>
    </div>
  )
}

// ── Stamp chooser ─────────────────────────────────────────────────────────────

function StampChooser({ role, conversationId, onStampSent }: {
  role: 'buyer' | 'seller'; conversationId: string; onStampSent: () => void
}) {
  const stamps = role === 'buyer' ? BUYER_STAMPS : SELLER_STAMPS
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState<StampKey | null>(null)

  async function sendStamp(key: StampKey) {
    setSending(key)
    try {
      await fetch(`/api/conversations/${conversationId}/stamp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stampKey: key }),
      })
      onStampSent()
      setOpen(false)
    } finally {
      setSending(null)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          height: 40, padding: '0 14px', borderRadius: 'var(--r-pill)',
          background: open ? 'var(--bg-sunk)' : 'var(--bg-elevated)',
          border: '1.5px solid var(--border)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 500, color: 'var(--fg)',
          transition: 'all 150ms',
        }}
      >
        <i className="iconoir-chat-bubble" style={{ fontSize: 16 }} />
        Mensaje
        <i className={`iconoir-nav-arrow-${open ? 'down' : 'up'}`} style={{ fontSize: 12, color: 'var(--fg-muted)' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', bottom: 52, left: 0, zIndex: 40,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-3)',
            minWidth: 280, maxWidth: 340, overflow: 'hidden',
            animation: `slide-up 200ms ${SPRING}`,
          }}
        >
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mensajes rápidos</p>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {stamps.map(({ key, text }) => (
              <button
                key={key}
                type="button"
                onClick={() => sendStamp(key)}
                disabled={sending === key}
                style={{
                  width: '100%', padding: '11px 14px', textAlign: 'left', background: 'none',
                  border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  fontSize: 14, color: 'var(--fg)', lineHeight: 1.4,
                  opacity: sending === key ? 0.5 : 1,
                }}
                className="hover:bg-[var(--bg-sunk)]"
              >
                {sending === key ? '…' : text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConversationClient({ conversationId, initialConversation, initialEvents, role }: Props) {
  const [conv, setConv] = useState(initialConversation)
  const [events, setEvents] = useState(initialEvents)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pull-to-refresh state
  const [pullY, setPullY] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const PULL_THRESHOLD = 64

  const listing = conv.marketplace_listings
  const shop    = conv.marketplace_shops
  const offer   = conv.marketplace_offers
  const agreedCents = offer?.status === 'accepted' || offer?.status === 'paid'
    ? offer.counter_amount_cents ?? offer.offer_amount_cents
    : null
  const headerPrice = agreedCents
    ? fmt(agreedCents, offer?.currency ?? listing?.currency ?? 'MXN')
    : listing?.price_cents
      ? fmt(listing.price_cents, listing.currency)
      : 'Precio a consultar'

  // Scroll to bottom on load and new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`)
      const data = await res.json() as { conversation: typeof conv; events: typeof events }
      setConv(data.conversation)
      setEvents(data.events)
    } catch {
      // silent
    }
  }, [conversationId])

  // Pull-to-refresh gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY
    } else {
      touchStartY.current = 0
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartY.current) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) {
      e.preventDefault()
      setPullY(Math.min(dy * 0.4, PULL_THRESHOLD + 20))
    }
  }, [])

  const handleTouchEnd = useCallback(async () => {
    if (pullY >= PULL_THRESHOLD) {
      setIsRefreshing(true)
      setPullY(0)
      await refresh()
      setIsRefreshing(false)
    } else {
      setPullY(0)
    }
    touchStartY.current = 0
  }, [pullY, refresh])

  // Poll every 5 s while tab is visible (real-time updates without WebSockets)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 5000)
    return () => clearInterval(id)
  }, [refresh])

  // Group events by day for date separators
  const grouped: Array<{ date: string; events: ConvEvent[] }> = []
  for (const ev of events) {
    const last = grouped[grouped.length - 1]
    if (!last || !sameDay(last.events[last.events.length - 1].created_at, ev.created_at)) {
      grouped.push({ date: ev.created_at, events: [ev] })
    } else {
      last.events.push(ev)
    }
  }

  const showActionBar = offer && conv.status === 'active'
  const isClosed = conv.status !== 'active'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Listing header */}
      <Link href={`/l/${listing?.id}`} className="no-underline" style={{ flexShrink: 0 }}>
        <div
          className="flex items-center gap-3"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
        >
          {listing?.images?.[0] ? (
            <img src={listing.images[0].url} alt={listing.title} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 'var(--r-md)', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 44, height: 44, background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', flexShrink: 0 }} />
          )}
          <div className="flex-1 min-w-0">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {listing?.title}
              </p>
              {listing?.status && (
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: listing.status === 'active' ? 'var(--success)' : 'var(--fg-muted)', background: listing.status === 'active' ? 'var(--success-soft)' : 'var(--bg-sunk)', borderRadius: 'var(--r-pill)', padding: '2px 7px' }}>
                  {listingStatusLabel(listing.status)}
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: agreedCents ? 'var(--success)' : 'var(--fg-muted)', fontWeight: agreedCents ? 800 : 400 }}>
              {agreedCents ? 'Precio acordado: ' : ''}{headerPrice}
              <span style={{ marginLeft: 6, color: 'var(--fg-muted)', fontWeight: 400 }}>· {listingTypeLabel(listing?.listing_type)}</span>
              {role === 'buyer' && shop && (
                <span style={{ marginLeft: 6, color: 'var(--fg-muted)', fontWeight: 400 }}>· {shop.name}</span>
              )}
            </p>
          </div>
          <i className="iconoir-arrow-up-right" style={{ fontSize: 14, color: 'var(--fg-muted)', flexShrink: 0 }} />
        </div>
      </Link>

      {/* Agent CTA */}
      <div style={{ flexShrink: 0, padding: '8px 16px', background: 'var(--agent-soft)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className="iconoir-sparks" style={{ fontSize: 14, color: 'var(--agent)' }} />
        <span style={{ fontSize: 12, color: 'var(--agent)' }}>
          {role === 'buyer'
            ? 'Tu agente puede negociar por ti automáticamente.'
            : 'Activa la negociación automática en configuración.'}
        </span>
        <Link href={role === 'buyer' ? '/agent' : '/shop/manage/settings/negociacion'} style={{ fontSize: 12, fontWeight: 600, color: 'var(--agent)', textDecoration: 'underline', marginLeft: 'auto', flexShrink: 0 }}>
          {role === 'buyer' ? 'Enviar agente' : 'Configurar'}
        </Link>
      </div>

      {/* Events scroll area */}
      <div
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ flex: 1, overflowY: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column', touchAction: pullY > 0 ? 'none' : 'auto' }}
      >
        {/* Pull-to-refresh indicator */}
        {(pullY > 0 || isRefreshing) && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: isRefreshing ? 40 : pullY,
            transition: isRefreshing ? 'none' : 'height 60ms',
            overflow: 'hidden', flexShrink: 0,
          }}>
            <div style={{
              fontSize: 20,
              transform: `rotate(${isRefreshing ? 0 : Math.min((pullY / PULL_THRESHOLD) * 180, 180)}deg)`,
              transition: isRefreshing ? 'none' : 'transform 100ms',
              animation: isRefreshing ? 'spin 600ms linear infinite' : 'none',
            }}>
              ↻
            </div>
          </div>
        )}
        {events.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>
            No hay eventos aún.
          </div>
        )}
        {grouped.map(({ date, events: dayEvents }) => (
          <div key={date}>
            {/* Date separator */}
            <div style={{ textAlign: 'center', padding: '12px 0 6px' }}>
              <span style={{ fontSize: 11, color: 'var(--fg-subtle)', background: 'var(--bg-sunk)', borderRadius: 'var(--r-pill)', padding: '3px 10px', display: 'inline-block' }}>
                {formatDate(date)}
              </span>
            </div>
            {dayEvents.map(ev => (
              <EventBubble key={ev.id} event={ev} role={role} />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Action bar / stamp chooser */}
      {!isClosed && (
        <div style={{ flexShrink: 0 }}>
          {showActionBar && (
            <OfferActionBar
              offer={offer}
              role={role}
              listing={listing}
              checkoutProvider={conv.checkout_provider}
              isSignedIn
              onRefresh={refresh}
            />
          )}
          {/* Stamp input bar */}
          <div style={{ padding: '10px 16px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
            <StampChooser role={role} conversationId={conversationId} onStampSent={refresh} />
            <div style={{ flex: 1, fontSize: 13, color: 'var(--fg-muted)', fontStyle: 'italic', paddingLeft: 4 }}>
              Usa mensajes estructurados — sin texto libre
            </div>
          </div>
        </div>
      )}

      {isClosed && (
        <div style={{ flexShrink: 0, padding: '14px 16px', background: 'var(--bg-sunk)', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Esta conversación está cerrada.</p>
        </div>
      )}
    </div>
  )
}
