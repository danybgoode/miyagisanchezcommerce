'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  canAccept, canCounter, canDecline, isExpired,
  formatOfferAmount, offerQuality, timeAgo, timeUntil,
  type Offer,
} from '@/lib/offers'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InboxOffer extends Omit<Offer, 'shop_id' | 'buyer_clerk_user_id' | 'checkout_session_id' | 'checkout_expires_at'> {
  listing_id: string
  marketplace_listings: {
    id: string
    title: string
    price_cents: number
    currency: string
    images: Array<{ url: string }> | null
    status: string
    listing_type: string
  }
}

interface OfferInboxProps {
  shopId: string
  shopSlug: string
  initialOffers: InboxOffer[]
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      <span>{type === 'success' ? '✓' : '⚠'}</span>
      <span>{message}</span>
    </div>
  )
}

function QualityBadge({ offerCents, askingCents }: { offerCents: number; askingCents: number }) {
  const q = offerQuality(offerCents, askingCents)
  const styles = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${styles[q.color]}`}>
      {q.pct}% · {q.label}
    </span>
  )
}

// ── Counter modal ─────────────────────────────────────────────────────────────

function CounterModal({
  offer,
  onClose,
  onSubmit,
}: {
  offer: InboxOffer
  onClose: () => void
  onSubmit: (counterCents: number, msg: string) => Promise<void>
}) {
  const asking = offer.marketplace_listings.price_cents
  const suggested = Math.round((offer.offer_amount_cents + asking) / 2)
  const [counterAmount, setCounterAmount] = useState((suggested / 100).toFixed(0))
  const [counterMsg, setCounterMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cents = Math.round(parseFloat(counterAmount) * 100) || 0

  async function submit() {
    if (cents <= offer.offer_amount_cents) {
      setError('Debe ser mayor a la oferta del comprador.')
      return
    }
    if (cents >= asking) {
      setError('Debe ser menor al precio de lista.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(cents, counterMsg.trim())
      onClose()
    } catch {
      setError('Error al enviar. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="font-bold text-base">Contraoferta</h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 text-lg">×</button>
        </div>

        <div className="px-5 pb-5">
          {/* Context */}
          <div className="grid grid-cols-3 gap-2 mb-4 text-center text-xs">
            <div className="bg-[var(--color-surface-alt)] rounded-lg p-2.5">
              <div className="font-semibold text-[var(--color-text)]">{formatOfferAmount(offer.offer_amount_cents, offer.marketplace_listings.currency)}</div>
              <div className="text-[var(--color-muted)] mt-0.5">Oferta</div>
            </div>
            <div className="flex items-center justify-center text-[var(--color-muted)]">→</div>
            <div className="bg-[var(--color-surface-alt)] rounded-lg p-2.5">
              <div className="font-semibold text-[var(--color-text)]">{formatOfferAmount(asking, offer.marketplace_listings.currency)}</div>
              <div className="text-[var(--color-muted)] mt-0.5">Lista</div>
            </div>
          </div>

          <label className="block text-sm font-medium mb-1.5">Tu contraoferta</label>
          <div className="relative mb-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)]">$</span>
            <input
              type="number"
              value={counterAmount}
              onChange={e => { setCounterAmount(e.target.value); setError('') }}
              className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-14 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-muted)]">
              {offer.marketplace_listings.currency}
            </span>
          </div>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Sugerido: <button type="button" className="text-[var(--color-accent)] underline"
              onClick={() => setCounterAmount((suggested / 100).toFixed(0))}>
              {formatOfferAmount(suggested, offer.marketplace_listings.currency)} (punto medio)
            </button>
          </p>
          {error && <p className="text-red-600 text-xs mb-3">⚠ {error}</p>}

          <label className="block text-sm font-medium mb-1.5">
            Mensaje <span className="text-xs font-normal text-[var(--color-muted)]">Opcional</span>
          </label>
          <textarea
            value={counterMsg}
            onChange={e => setCounterMsg(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Ej: &quot;Es mi mejor precio, incluye envío.&quot;"
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none mb-4"
          />

          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4">
            <span className="text-sm">⏰</span>
            <p className="text-xs text-blue-700">El comprador tiene <strong>24 horas</strong> para responder.</p>
          </div>

          <button type="button" onClick={submit} disabled={busy}
            className="w-full bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors">
            {busy ? 'Enviando…' : 'Enviar contraoferta'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Offer card ────────────────────────────────────────────────────────────────

function OfferCard({
  offer,
  onRespond,
}: {
  offer: InboxOffer
  onRespond: (offerId: string, action: 'accept' | 'decline' | 'counter-open') => void
}) {
  const listing = offer.marketplace_listings
  const thumb = listing.images?.[0]?.url ?? null
  const expired = isExpired(offer)
  const isPending = offer.status === 'pending' && !expired
  const isCountered = offer.status === 'countered'

  const statusStyle: Record<string, string> = {
    pending:  'bg-amber-100 text-amber-700',
    countered:'bg-blue-100 text-blue-700',
    accepted: 'bg-green-100 text-green-700',
    declined: 'bg-gray-100 text-gray-500',
    expired:  'bg-gray-100 text-gray-400',
    paid:     'bg-green-100 text-green-700',
  }
  const statusLabel: Record<string, string> = {
    pending:   expired ? 'Expirada' : 'Pendiente',
    countered: 'Contraoferta enviada',
    accepted:  'Aceptada',
    declined:  'Rechazada',
    expired:   'Expirada',
    paid:      'Pagada ✓',
  }

  const effectiveStatus = expired ? 'expired' : offer.status

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${
      isPending ? 'border-amber-200 bg-amber-50/30' :
      isCountered ? 'border-blue-200 bg-blue-50/20' :
      'border-[var(--color-border)] bg-white opacity-75'
    }`}>
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          {thumb ? (
            <img src={thumb} alt={listing.title}
              className="w-12 h-12 object-cover rounded-lg flex-shrink-0 border border-[var(--color-border)]" />
          ) : (
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center text-xl">📦</div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <Link href={`/l/${listing.id}`}
              className="text-sm font-semibold text-[var(--color-text)] hover:text-[var(--color-accent)] truncate block no-underline">
              {listing.title}
            </Link>
            <div className="text-xs text-[var(--color-muted)] mt-0.5">
              Lista: {formatOfferAmount(listing.price_cents, listing.currency)}
            </div>
          </div>

          {/* Status badge */}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusStyle[effectiveStatus] ?? statusStyle.expired}`}>
            {statusLabel[effectiveStatus] ?? effectiveStatus}
          </span>
        </div>

        {/* Offer amount + buyer */}
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="text-2xl font-bold text-[var(--color-text)]">
              {formatOfferAmount(offer.offer_amount_cents, listing.currency)}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <QualityBadge offerCents={offer.offer_amount_cents} askingCents={listing.price_cents} />
              <span className="text-xs text-[var(--color-muted)]">
                de {offer.buyer_name} · {timeAgo(offer.created_at)}
              </span>
            </div>
          </div>
          {isPending && offer.expires_at && (
            <div className="text-right">
              <div className="text-xs text-[var(--color-muted)]">Expira en</div>
              <div className="text-xs font-semibold text-amber-600">{timeUntil(offer.expires_at)}</div>
            </div>
          )}
        </div>

        {/* Buyer message */}
        {offer.message && (
          <blockquote className="mt-2.5 text-sm text-[var(--color-text)] border-l-2 border-[var(--color-border)] pl-3 italic">
            &ldquo;{offer.message}&rdquo;
          </blockquote>
        )}

        {/* Counter info (already sent) */}
        {isCountered && offer.counter_amount_cents && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
            <div className="text-xs text-blue-600 mb-0.5">Tu contraoferta</div>
            <div className="text-base font-bold text-blue-800">
              {formatOfferAmount(offer.counter_amount_cents, listing.currency)}
            </div>
            {offer.counter_message && (
              <p className="text-xs text-blue-700 mt-1 italic">&ldquo;{offer.counter_message}&rdquo;</p>
            )}
            {offer.counter_expires_at && (
              <p className="text-xs text-blue-500 mt-1">Comprador responde antes: {timeUntil(offer.counter_expires_at)}</p>
            )}
          </div>
        )}
      </div>

      {/* Action row — only for actionable offers */}
      {isPending && (
        <div className="border-t border-amber-200 grid grid-cols-3 divide-x divide-amber-200">
          <button type="button"
            onClick={() => onRespond(offer.id, 'accept')}
            className="py-3 text-sm font-semibold text-green-700 hover:bg-green-50 transition-colors flex items-center justify-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Aceptar
          </button>
          <button type="button"
            onClick={() => onRespond(offer.id, 'counter-open')}
            className="py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1.5">
            ↩ Contraoferta
          </button>
          <button type="button"
            onClick={() => onRespond(offer.id, 'decline')}
            className="py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5">
            ✕ Rechazar
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OfferInbox({ shopId, shopSlug, initialOffers }: OfferInboxProps) {
  const [offers, setOffers] = useState<InboxOffer[]>(initialOffers)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [counterOffer, setCounterOffer] = useState<InboxOffer | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  async function respond(offerId: string, action: 'accept' | 'decline') {
    setBusyId(offerId)
    try {
      const res = await fetch(`/api/offers/${offerId}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) { showToast(data.error ?? 'Error al responder.', 'error'); return }

      setOffers(prev => prev.map(o => o.id === offerId ? { ...o, status: data.status as Offer['status'] } : o))
      showToast(
        action === 'accept' ? '✓ Oferta aceptada — el comprador recibió el enlace de pago.' : 'Oferta rechazada.',
        'success'
      )
    } catch {
      showToast('Sin conexión. Inténtalo de nuevo.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function sendCounter(offerId: string, counterCents: number, counterMsg: string) {
    const res = await fetch(`/api/offers/${offerId}/respond`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'counter', counterAmountCents: counterCents, counterMessage: counterMsg }),
    })
    const data = await res.json() as { status?: string; error?: string }
    if (!res.ok) throw new Error(data.error ?? 'Error')

    const counterExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    setOffers(prev => prev.map(o =>
      o.id === offerId
        ? { ...o, status: 'countered', counter_amount_cents: counterCents, counter_message: counterMsg, counter_expires_at: counterExpiresAt }
        : o
    ))
    showToast('Contraoferta enviada — el comprador tiene 24 horas para responder.', 'success')
  }

  function handleRespond(offerId: string, action: 'accept' | 'decline' | 'counter-open') {
    const offer = offers.find(o => o.id === offerId)
    if (!offer) return
    if (action === 'counter-open') {
      setCounterOffer(offer)
    } else {
      respond(offerId, action)
    }
  }

  const pendingOffers = offers.filter(o => o.status === 'pending' && !isExpired(o))
  const displayedOffers = filter === 'pending' ? pendingOffers : offers

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <nav className="text-xs text-[var(--color-muted)] mb-6 flex items-center gap-1.5">
        <Link href="/shop/manage" className="hover:text-[var(--color-foreground)] no-underline">Mi tienda</Link>
        <span>›</span>
        <span>Ofertas</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Ofertas</h1>
          {pendingOffers.length > 0 && (
            <p className="text-sm text-[var(--color-muted)] mt-0.5">
              {pendingOffers.length} oferta{pendingOffers.length > 1 ? 's' : ''} pendiente{pendingOffers.length > 1 ? 's' : ''} de respuesta
            </p>
          )}
        </div>
        <Link href="/shop/manage"
          className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] no-underline">
          ← Panel
        </Link>
      </div>

      {/* Response time nudge */}
      {pendingOffers.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <span className="text-lg">⚡</span>
          <p className="text-sm text-amber-800">
            Los compradores que esperan más de 2 horas compran en otro lugar.
            <strong className="ml-1">Responde rápido para cerrar el trato.</strong>
          </p>
        </div>
      )}

      {/* Filter tabs */}
      {offers.length > 0 && (
        <div className="flex gap-1 mb-5 border border-[var(--color-border)] rounded-lg p-1 w-fit">
          {(['pending', 'all'] as const).map(f => (
            <button key={f} type="button"
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}>
              {f === 'pending' ? (
                <>Pendientes {pendingOffers.length > 0 && <span className="ml-1 bg-white/30 rounded-full px-1.5 text-xs">{pendingOffers.length}</span>}</>
              ) : 'Todas'}
            </button>
          ))}
        </div>
      )}

      {/* Offer list */}
      {displayedOffers.length === 0 ? (
        <div className="text-center py-16">
          {filter === 'pending' && offers.length > 0 ? (
            <>
              <div className="text-4xl mb-3">✓</div>
              <h3 className="font-semibold text-lg mb-1">Al día</h3>
              <p className="text-sm text-[var(--color-muted)]">No tienes ofertas pendientes.</p>
              <button type="button" onClick={() => setFilter('all')}
                className="mt-3 text-sm text-[var(--color-accent)] underline">
                Ver historial
              </button>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">💬</div>
              <h3 className="font-semibold text-lg mb-1">Sin ofertas aún</h3>
              <p className="text-sm text-[var(--color-muted)] mb-4">
                Cuando los compradores hagan ofertas en tus anuncios, aparecerán aquí.
              </p>
              <Link href={`/s/${shopSlug}`}
                className="text-sm text-[var(--color-accent)] no-underline hover:underline">
                Ver tu tienda →
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {displayedOffers.map(offer => (
            <OfferCard
              key={offer.id}
              offer={offer}
              onRespond={busyId ? () => {} : handleRespond}
            />
          ))}
        </div>
      )}

      {/* Counter modal */}
      {counterOffer && (
        <CounterModal
          offer={counterOffer}
          onClose={() => setCounterOffer(null)}
          onSubmit={async (cents, msg) => {
            await sendCounter(counterOffer.id, cents, msg)
            setCounterOffer(null)
          }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  )
}
