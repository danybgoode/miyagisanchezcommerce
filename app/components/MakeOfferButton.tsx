'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import {
  OFFER_ANCHORS,
  anchorAmount,
  validateOfferAmount,
  formatOfferAmount,
  timeUntil,
  type Offer,
} from '@/lib/offers'

interface MakeOfferButtonProps {
  listing: {
    id: string
    title: string
    price_cents: number
    currency: string
    imageUrl?: string | null
  }
  buyerInfo?: { name: string; email: string }
  isSignedIn: boolean
}

// ── Quality bar ───────────────────────────────────────────────────────────────

function QualityBar({ offerCents, askingCents }: { offerCents: number; askingCents: number }) {
  if (offerCents <= 0 || offerCents >= askingCents) return null
  const pct = Math.round((offerCents / askingCents) * 100)
  const barWidth = Math.max(0, Math.min(100, ((pct - 30) / 70) * 100))
  const color = pct >= 85 ? 'var(--success)' : pct >= 70 ? 'var(--warning)' : 'var(--danger)'
  const label = pct >= 85 ? 'Oferta razonable' : pct >= 70 ? 'Algo por debajo' : 'Oferta baja'
  return (
    <div className="mt-1.5">
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, width: `${barWidth}%`, background: color, transition: 'width 200ms' }} />
      </div>
      <div className="flex justify-between" style={{ fontSize: 11, marginTop: 3, color }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{pct}% del precio</span>
      </div>
    </div>
  )
}

// ── Active offer status card ──────────────────────────────────────────────────

function ActiveOfferCard({
  offer, listing, conversationId, onWithdraw, onAcceptCounter, onDeclineCounter,
}: {
  offer: Offer
  listing: MakeOfferButtonProps['listing']
  conversationId?: string
  onWithdraw: () => void
  onAcceptCounter: () => void
  onDeclineCounter: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const wrap = useCallback((fn: () => void) => async () => {
    setBusy(true)
    try { fn() } finally { setBusy(false) }
  }, [])

  const viewThread = conversationId
    ? <button type="button" onClick={() => router.push(`/messages/${conversationId}`)} className="text-xs underline mt-2 block" style={{ color: 'var(--accent)' }}>Ver conversación →</button>
    : null

  if (offer.status === 'pending') {
    return (
      <div className="w-full rounded-xl p-4" style={{ border: '1.5px solid var(--warning)', background: 'var(--warning-soft)' }}>
        <div className="flex items-start gap-3">
          <span style={{ fontSize: 20, marginTop: 2 }}>⏳</span>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning)' }}>Oferta enviada</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 2 }}>
              Tu oferta de <strong>{formatOfferAmount(offer.offer_amount_cents, listing.currency)}</strong> espera respuesta del vendedor.
            </div>
            {offer.expires_at && (
              <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>Expira en {timeUntil(offer.expires_at)}</div>
            )}
          </div>
        </div>
        {viewThread}
        <button
          type="button"
          onClick={wrap(onWithdraw)}
          disabled={busy}
          style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8, textDecoration: 'underline' }}
          className="disabled:opacity-50"
        >
          Retirar oferta
        </button>
      </div>
    )
  }

  if (offer.status === 'countered' && offer.counter_amount_cents) {
    const counterExpired = offer.counter_expires_at ? new Date(offer.counter_expires_at) < new Date() : false
    return (
      <div className="w-full rounded-xl p-4" style={{ border: '1.5px solid var(--info)', background: 'var(--info-soft)' }}>
        <div className="flex items-start gap-3 mb-3">
          <span style={{ fontSize: 20, marginTop: 2 }}>↩</span>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--info)' }}>El vendedor contraoferta</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--info)', marginTop: 4 }}>
              {formatOfferAmount(offer.counter_amount_cents, listing.currency)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
              Tu oferta: {formatOfferAmount(offer.offer_amount_cents, listing.currency)}
              {' · '}Precio: {formatOfferAmount(listing.price_cents, listing.currency)}
            </div>
            {offer.counter_message && (
              <blockquote style={{ fontSize: 13, color: 'var(--info)', borderLeft: '2px solid var(--info)', paddingLeft: 10, marginTop: 8, fontStyle: 'italic' }}>
                &ldquo;{offer.counter_message}&rdquo;
              </blockquote>
            )}
            {offer.counter_expires_at && !counterExpired && (
              <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600, marginTop: 6 }}>
                ⏰ Expira en {timeUntil(offer.counter_expires_at)}
              </div>
            )}
          </div>
        </div>
        {viewThread}
        {!counterExpired && (
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={wrap(onAcceptCounter)}
              disabled={busy}
              className="flex-1 font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50 transition-colors"
              style={{ background: 'var(--accent)', color: 'var(--fg-inverse)' }}
            >
              {busy ? '…' : <><i className="iconoir-check" aria-hidden /> Aceptar trato</>}
            </button>
            <button
              type="button"
              onClick={wrap(onDeclineCounter)}
              disabled={busy}
              className="flex-1 font-medium py-2.5 rounded-lg text-sm disabled:opacity-50 transition-colors"
              style={{ border: '1px solid var(--border)', color: 'var(--fg)', background: 'var(--bg-elevated)' }}
            >
              Rechazar
            </button>
          </div>
        )}
      </div>
    )
  }

  if (offer.status === 'accepted') {
    const agreedCents = offer.counter_amount_cents ?? offer.offer_amount_cents
    return (
      <div className="w-full rounded-xl p-4" style={{ border: '1.5px solid var(--success)', background: 'var(--success-soft)' }}>
        <div className="flex items-start gap-3">
          <i className="iconoir-check-circle" aria-hidden style={{ fontSize: 20, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>¡Oferta aceptada!</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 2 }}>
              Ya puedes completar la compra al precio acordado:{' '}
              <strong>{formatOfferAmount(agreedCents, listing.currency)}</strong>.
            </div>
            {offer.checkout_expires_at && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>⏰ Expira en {timeUntil(offer.checkout_expires_at)}</div>
            )}
          </div>
        </div>
        {viewThread}
      </div>
    )
  }

  return null
}

// ── Main component ────────────────────────────────────────────────────────────

type ModalStep = 'idle' | 'form' | 'submitting' | 'success' | 'error'

export default function MakeOfferButton({ listing, buyerInfo, isSignedIn }: MakeOfferButtonProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [step, setStep] = useState<ModalStep>('idle')
  const [activeOffer, setActiveOffer] = useState<Offer | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(15)
  const [amountInput, setAmountInput] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const offerCents = Math.round(parseFloat(amountInput.replace(/,/g, '')) * 100) || 0

  // Load active offer on mount (only if signed in)
  useEffect(() => {
    if (!isSignedIn) return
    async function load() {
      try {
        const res = await fetch(`/api/offers?listingId=${listing.id}`)
        const data = await res.json() as { offer: Offer | null; conversationId?: string }
        setActiveOffer(data.offer)
        if (data.conversationId) setActiveConversationId(data.conversationId)
      } catch {
        // silent
      }
    }
    load()
  }, [listing.id, isSignedIn])

  useEffect(() => {
    if (step !== 'form') return
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') setStep('idle') }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [step])

  function selectAnchor(pct: number) {
    setSelectedAnchor(pct)
    const cents = anchorAmount(listing.price_cents, pct)
    setAmountInput((cents / 100).toFixed(0))
    setFieldErrors(p => ({ ...p, amount: '' }))
  }

  function openModal() {
    selectAnchor(15)
    setFieldErrors({})
    setErrorMsg('')
    setStep('form')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function handleSubmit() {
    const errors: Record<string, string> = {}
    const validation = validateOfferAmount(offerCents, listing.price_cents)
    if (!validation.ok) errors.amount = validation.message ?? 'Monto inválido.'
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return }

    setStep('submitting')
    try {
      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: listing.id,
          offerAmountCents: offerCents,
        }),
      })
      const data = await res.json() as { offerId?: string; conversationId?: string; error?: string; field?: string }

      if (!res.ok) {
        if (data.field) {
          setFieldErrors({ [data.field]: data.error ?? 'Error.' })
          setStep('form')
        } else {
          setErrorMsg(data.error ?? 'No se pudo enviar la oferta.')
          setStep('error')
        }
        return
      }

      // Redirect to conversation thread
      if (data.conversationId) {
        router.push(`/messages/${data.conversationId}`)
      } else {
        setStep('success')
      }
    } catch {
      setErrorMsg('Sin conexión. Inténtalo de nuevo.')
      setStep('error')
    }
  }

  async function handleWithdraw() {
    if (!activeOffer) return
    const res = await fetch(`/api/offers/${activeOffer.id}/buyer-respond`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'withdraw' }),
    })
    if (res.ok) setActiveOffer(null)
  }

  async function handleAcceptCounter() {
    if (!activeOffer) return
    await fetch(`/api/offers/${activeOffer.id}/buyer-respond`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept-counter' }),
    })
    if (activeConversationId) router.push(`/messages/${activeConversationId}`)
  }

  async function handleDeclineCounter() {
    if (!activeOffer) return
    await fetch(`/api/offers/${activeOffer.id}/buyer-respond`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'withdraw' }),
    })
    setActiveOffer(null)
  }

  const amountValidation = offerCents > 0 ? validateOfferAmount(offerCents, listing.price_cents) : null

  // Not signed in — auth prompt
  if (!isSignedIn) {
    return (
      <a
        href={`/sign-in?redirect_url=${encodeURIComponent(pathname)}`}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
        style={{ border: '2px solid var(--fg)', color: 'var(--fg)', background: 'transparent' }}
      >
        <i className="iconoir-log-in" style={{ fontSize: 16 }} />
        Inicia sesión para hacer oferta
      </a>
    )
  }

  if (activeOffer && ['pending', 'countered', 'accepted'].includes(activeOffer.status)) {
    return (
      <ActiveOfferCard
        offer={activeOffer}
        listing={listing}
        conversationId={activeConversationId ?? undefined}
        onWithdraw={handleWithdraw}
        onAcceptCounter={handleAcceptCounter}
        onDeclineCounter={handleDeclineCounter}
      />
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm transition-colors"
        style={{ border: '2px solid var(--fg)', color: 'var(--fg)', background: 'transparent' }}
      >
        <i className="iconoir-message-text" style={{ fontSize: 16 }} />
        Hacer oferta
      </button>

      {step !== 'idle' && createPortal(
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center p-4"
          style={{ zIndex: 'var(--z-overlay)', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setStep('idle') }}
        >
          <div
            className="w-full max-w-md overflow-y-auto"
            style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-4)', maxHeight: '90vh' }}
            role="dialog" aria-modal="true" aria-label="Hacer oferta"
          >
            {/* Header */}
            <div className="flex items-center justify-between" style={{ padding: '20px 20px 12px' }}>
              <h2 style={{ fontWeight: 700, fontSize: 18 }}>Hacer oferta</h2>
              <button
                type="button"
                onClick={() => setStep('idle')}
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-sunk)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}
                aria-label="Cerrar"
              >
                <i className="iconoir-xmark" style={{ fontSize: 16 }} />
              </button>
            </div>

            {/* Listing context */}
            <div className="flex items-center gap-3" style={{ margin: '0 20px 16px', padding: '12px', background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
              {listing.imageUrl ? (
                <img src={listing.imageUrl} alt={listing.title} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              ) : (
                <div style={{ width: 48, height: 48, background: 'var(--bg-sunk)', borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="iconoir-package" style={{ fontSize: 24, color: 'var(--fg-subtle)' }} />
                </div>
              )}
              <div className="min-w-0">
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</div>
                <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                  Precio: <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{formatOfferAmount(listing.price_cents, listing.currency)}</span>
                </div>
              </div>
            </div>

            {/* Success */}
            {step === 'success' && (
              <div style={{ padding: '0 20px 24px', textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--success-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <i className="iconoir-check-circle" style={{ fontSize: 28, color: 'var(--success)' }} />
                </div>
                <h3 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>¡Oferta enviada!</h3>
                <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 20 }}>El vendedor tiene 48 horas para responder. Te avisaremos por correo.</p>
                <button type="button" onClick={() => setStep('idle')} className="btn btn-primary" style={{ padding: '10px 32px' }}>Entendido</button>
              </div>
            )}

            {/* Error */}
            {step === 'error' && (
              <div style={{ padding: '0 20px 24px', textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--danger-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <i className="iconoir-warning-triangle" style={{ fontSize: 28, color: 'var(--danger)' }} />
                </div>
                <h3 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Algo salió mal</h3>
                <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 20 }}>{errorMsg}</p>
                <button type="button" onClick={() => setStep('form')} style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'underline' }}>Intentar de nuevo</button>
              </div>
            )}

            {/* Form */}
            {(step === 'form' || step === 'submitting') && (
              <div style={{ padding: '0 20px 20px' }}>
                {/* Anchor quick-select */}
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Selección rápida</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                  {OFFER_ANCHORS.map(({ pct, label }) => {
                    const cents = anchorAmount(listing.price_cents, pct)
                    const sel = selectedAnchor === pct
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => selectAnchor(pct)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          padding: '12px 8px', borderRadius: 'var(--r-md)',
                          border: sel ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                          background: sel ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                          cursor: 'pointer', transition: 'all 150ms',
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: sel ? 'var(--accent)' : 'var(--fg)' }}>{label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: sel ? 'var(--accent)' : 'var(--fg)' }}>{formatOfferAmount(cents, listing.currency)}</span>
                        <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>ahorras {formatOfferAmount(listing.price_cents - cents, listing.currency)}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Custom amount */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>O ingresa tu oferta</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--fg-muted)', fontWeight: 500 }}>$</span>
                    <input
                      ref={inputRef}
                      type="number"
                      inputMode="numeric"
                      value={amountInput}
                      onChange={e => { setSelectedAnchor(null); setAmountInput(e.target.value); setFieldErrors(p => ({ ...p, amount: '' })) }}
                      placeholder={(listing.price_cents * 0.85 / 100).toFixed(0)}
                      min={1}
                      style={{
                        width: '100%', border: '1.5px solid var(--border)', borderRadius: 'var(--r-md)',
                        paddingLeft: 28, paddingRight: 52, paddingTop: 10, paddingBottom: 10,
                        fontSize: 14, fontFamily: 'var(--font-sans)', color: 'var(--fg)',
                        background: 'var(--bg-elevated)', outline: 'none',
                        boxSizing: 'border-box',
                      }}
                      className="focus:ring-2 focus:ring-[var(--accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--fg-muted)' }}>{listing.currency}</span>
                  </div>
                  {offerCents > 0 && offerCents < listing.price_cents && <QualityBar offerCents={offerCents} askingCents={listing.price_cents} />}
                  {fieldErrors.amount && <p style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}><i className="iconoir-warning-triangle" aria-hidden /> {fieldErrors.amount}</p>}
                  {!fieldErrors.amount && amountValidation?.level === 'warn' && <p style={{ color: 'var(--warning)', fontSize: 11, marginTop: 4 }}><i className="iconoir-warning-triangle" aria-hidden /> {amountValidation.message}</p>}
                  {!fieldErrors.amount && amountValidation?.level === 'block' && offerCents > 0 && <p style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}><i className="iconoir-warning-triangle" aria-hidden /> {amountValidation.message}</p>}
                </div>

                {/* Expiry notice */}
                <div className="flex items-start gap-2" style={{ padding: '10px 12px', background: 'var(--bg-sunk)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', marginBottom: 16 }}>
                  <i className="iconoir-clock" style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 2, flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                    Tu oferta expira en <strong>48 horas</strong> si el vendedor no responde.
                    Si aceptan, recibirás un enlace de pago.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={step === 'submitting' || (amountValidation?.level === 'block' && offerCents > 0)}
                  className="w-full font-semibold rounded-xl text-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  style={{ background: 'var(--accent)', color: 'var(--fg-inverse)', padding: '13px 0', fontSize: 14 }}
                >
                  {step === 'submitting' ? (
                    <><span className="animate-spin inline-block">⟳</span> Enviando oferta…</>
                  ) : (
                    <>
                      <i className="iconoir-message-text" style={{ fontSize: 16 }} />
                      Enviar oferta — {offerCents > 0 ? formatOfferAmount(offerCents, listing.currency) : '…'}
                    </>
                  )}
                </button>
                <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--fg-subtle)', marginTop: 8 }}>
                  Sin comisiones · El vendedor tiene 48 horas para responder
                </p>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
