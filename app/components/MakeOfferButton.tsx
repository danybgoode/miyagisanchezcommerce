'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  OFFER_ANCHORS,
  anchorAmount,
  validateOfferAmount,
  formatOfferAmount,
  timeUntil,
  timeAgo,
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
  /** Pre-fill from Clerk if buyer is logged in */
  buyerInfo?: { name: string; email: string }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QualityBar({ offerCents, askingCents }: { offerCents: number; askingCents: number }) {
  if (offerCents <= 0 || offerCents >= askingCents) return null
  const pct = Math.round((offerCents / askingCents) * 100)
  const barWidth = Math.max(0, Math.min(100, ((pct - 30) / 70) * 100)) // 30–100% maps to 0–100%
  const color = pct >= 85 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626'
  const label = pct >= 85 ? 'Oferta razonable' : pct >= 70 ? 'Algo por debajo' : 'Oferta baja'

  return (
    <div className="mt-1.5">
      <div className="h-1 w-full bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-200" style={{ width: `${barWidth}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-[11px] mt-0.5" style={{ color }}>
        <span>{label}</span>
        <span className="font-mono">{pct}% del precio</span>
      </div>
    </div>
  )
}

// ── Offer status views (when buyer already has an active offer) ───────────────

function ActiveOfferCard({
  offer,
  listing,
  onWithdraw,
  onAcceptCounter,
  onDeclineCounter,
}: {
  offer: Offer
  listing: MakeOfferButtonProps['listing']
  onWithdraw: () => void
  onAcceptCounter: () => void
  onDeclineCounter: () => void
}) {
  const [busy, setBusy] = useState(false)

  const wrap = useCallback((fn: () => void) => async () => {
    setBusy(true)
    try { fn() } finally { setBusy(false) }
  }, [])

  if (offer.status === 'pending') {
    return (
      <div className="w-full border border-amber-200 bg-amber-50 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl mt-0.5">⏳</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-amber-800">Oferta enviada</div>
            <div className="text-sm text-amber-700 mt-0.5">
              Tu oferta de <strong>{formatOfferAmount(offer.offer_amount_cents, listing.currency)}</strong> espera respuesta del vendedor.
            </div>
            {offer.expires_at && (
              <div className="text-xs text-amber-600 mt-1">Expira en {timeUntil(offer.expires_at)}</div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={wrap(onWithdraw)}
          disabled={busy}
          className="mt-3 text-xs text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
        >
          Retirar oferta
        </button>
      </div>
    )
  }

  if (offer.status === 'countered' && offer.counter_amount_cents) {
    const counterExpired = offer.counter_expires_at ? new Date(offer.counter_expires_at) < new Date() : false
    return (
      <div className="w-full border border-blue-200 bg-blue-50 rounded-xl p-4">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-xl mt-0.5">↩</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-blue-800">El vendedor contraoferta</div>
            <div className="text-2xl font-bold text-blue-700 mt-1">
              {formatOfferAmount(offer.counter_amount_cents, listing.currency)}
            </div>
            <div className="text-xs text-blue-600 mt-0.5">
              Tu oferta original: {formatOfferAmount(offer.offer_amount_cents, listing.currency)}
              {' · '}Precio lista: {formatOfferAmount(listing.price_cents, listing.currency)}
            </div>
            {offer.counter_message && (
              <blockquote className="mt-2 text-sm text-blue-700 border-l-2 border-blue-300 pl-3 italic">
                &ldquo;{offer.counter_message}&rdquo;
              </blockquote>
            )}
            {offer.counter_expires_at && !counterExpired && (
              <div className="text-xs text-red-600 mt-1.5 font-medium">
                ⏰ Expira en {timeUntil(offer.counter_expires_at)}
              </div>
            )}
            {counterExpired && (
              <div className="text-xs text-gray-500 mt-1.5">Esta contraoferta ha expirado.</div>
            )}
          </div>
        </div>
        {!counterExpired && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={wrap(onAcceptCounter)}
              disabled={busy}
              className="flex-1 bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
            >
              {busy ? '…' : '✓ Aceptar trato'}
            </button>
            <button
              type="button"
              onClick={wrap(onDeclineCounter)}
              disabled={busy}
              className="flex-1 border border-[var(--color-border)] text-[var(--color-text)] font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Rechazar
            </button>
          </div>
        )}
      </div>
    )
  }

  if (offer.status === 'accepted') {
    return (
      <div className="w-full border border-green-200 bg-green-50 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl mt-0.5">✅</span>
          <div>
            <div className="text-sm font-semibold text-green-800">¡Oferta aceptada!</div>
            <div className="text-sm text-green-700 mt-0.5">
              Revisa tu correo para completar el pago de{' '}
              <strong>{formatOfferAmount(offer.offer_amount_cents, listing.currency)}</strong>.
            </div>
            {offer.checkout_expires_at && (
              <div className="text-xs text-red-600 mt-1">⏰ Expira en {timeUntil(offer.checkout_expires_at)}</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ── Main component ────────────────────────────────────────────────────────────

type ModalStep = 'idle' | 'form' | 'submitting' | 'success' | 'error'

export default function MakeOfferButton({ listing, buyerInfo }: MakeOfferButtonProps) {
  const [step, setStep] = useState<ModalStep>('idle')
  const [activeOffer, setActiveOffer] = useState<Offer | null>(null)
  const [loadingOffer, setLoadingOffer] = useState(true)

  // Form state
  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(15) // default -15%
  const [amountInput, setAmountInput] = useState('')
  const [message, setMessage] = useState('')
  const [buyerName, setBuyerName] = useState(buyerInfo?.name ?? '')
  const [buyerEmail, setBuyerEmail] = useState(buyerInfo?.email ?? '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const offerCents = Math.round(parseFloat(amountInput.replace(/,/g, '')) * 100) || 0

  // ── Load active offer on mount ────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoadingOffer(true)
      try {
        const email = buyerInfo?.email ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('offer_email') : null)
        const params = new URLSearchParams({ listingId: listing.id })
        if (email) params.set('email', email)
        const res = await fetch(`/api/offers?${params}`)
        const data = await res.json() as { offer: Offer | null }
        setActiveOffer(data.offer)
      } finally {
        setLoadingOffer(false)
      }
    }
    load()
  }, [listing.id, buyerInfo?.email])

  // ── Pre-fill when anchor is selected ─────────────────────────────────────
  function selectAnchor(pct: number) {
    setSelectedAnchor(pct)
    const cents = anchorAmount(listing.price_cents, pct)
    setAmountInput((cents / 100).toFixed(0))
    setFieldErrors(p => ({ ...p, amount: '' }))
  }

  function handleAmountChange(raw: string) {
    setSelectedAnchor(null)
    setAmountInput(raw)
    setFieldErrors(p => ({ ...p, amount: '' }))
  }

  // ── Open modal ────────────────────────────────────────────────────────────
  function openModal() {
    // Pre-fill default anchor
    selectAnchor(15)
    setMessage('')
    setBuyerName(buyerInfo?.name ?? '')
    setBuyerEmail(buyerInfo?.email ?? '')
    setFieldErrors({})
    setErrorMsg('')
    setStep('form')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // ── Close modal ───────────────────────────────────────────────────────────
  function closeModal() {
    setStep('idle')
  }

  // Close on Escape
  useEffect(() => {
    if (step !== 'form') return
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [step])

  // ── Submit offer ──────────────────────────────────────────────────────────
  async function handleSubmit() {
    const errors: Record<string, string> = {}
    if (!buyerName.trim()) errors.buyerName = 'Ingresa tu nombre.'
    if (!buyerEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      errors.buyerEmail = 'Ingresa un correo válido.'
    }

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
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim().toLowerCase(),
          offerAmountCents: offerCents,
          message: message.trim() || undefined,
        }),
      })
      const data = await res.json() as { offerId?: string; error?: string; field?: string }

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

      // Persist email for future lookups (anonymous buyers)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('offer_email', buyerEmail.trim().toLowerCase())
      }

      // Refresh active offer state
      const checkRes = await fetch(`/api/offers?listingId=${listing.id}&email=${encodeURIComponent(buyerEmail.trim())}`)
      const checkData = await checkRes.json() as { offer: Offer | null }
      setActiveOffer(checkData.offer)
      setStep('success')
    } catch {
      setErrorMsg('Sin conexión. Inténtalo de nuevo.')
      setStep('error')
    }
  }

  // ── Buyer actions ─────────────────────────────────────────────────────────
  async function handleWithdraw() {
    if (!activeOffer) return
    const email = buyerInfo?.email ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('offer_email') : '') ?? ''
    const res = await fetch(`/api/offers/${activeOffer.id}/buyer-respond`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'withdraw', buyerEmail: email }),
    })
    if (res.ok) setActiveOffer(null)
  }

  async function handleAcceptCounter() {
    if (!activeOffer) return
    const email = buyerInfo?.email ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('offer_email') : '') ?? ''
    const res = await fetch(`/api/offers/${activeOffer.id}/buyer-respond`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept-counter', buyerEmail: email }),
    })
    if (res.ok) {
      const refreshed = await fetch(`/api/offers?listingId=${listing.id}&email=${encodeURIComponent(email)}`)
      const data = await refreshed.json() as { offer: Offer | null }
      setActiveOffer(data.offer)
    }
  }

  async function handleDeclineCounter() {
    if (!activeOffer) return
    const email = buyerInfo?.email ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('offer_email') : '') ?? ''
    const res = await fetch(`/api/offers/${activeOffer.id}/buyer-respond`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'withdraw', buyerEmail: email }),
    })
    if (res.ok) setActiveOffer(null)
  }

  // ── Validation state ──────────────────────────────────────────────────────
  const amountValidation = offerCents > 0 ? validateOfferAmount(offerCents, listing.price_cents) : null

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingOffer) {
    return (
      <div className="h-10 bg-gray-100 animate-pulse rounded-lg" />
    )
  }

  // Active offer state — show status card
  if (activeOffer && ['pending', 'countered', 'accepted'].includes(activeOffer.status)) {
    return (
      <ActiveOfferCard
        offer={activeOffer}
        listing={listing}
        onWithdraw={handleWithdraw}
        onAcceptCounter={handleAcceptCounter}
        onDeclineCounter={handleDeclineCounter}
      />
    )
  }

  return (
    <>
      {/* ── Trigger button ──────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={openModal}
        className="flex items-center justify-center gap-2 w-full border-2 border-[var(--color-accent)] text-[var(--color-accent)] font-semibold py-2.5 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,white)] transition-colors"
      >
        <span>💬</span>
        Hacer oferta
      </button>

      {/* ── Modal ───────────────────────────────────────────────────────────── */}
      {step !== 'idle' && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            ref={modalRef}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Hacer oferta"
          >

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="font-bold text-lg">Hacer oferta</h2>
              <button
                type="button"
                onClick={closeModal}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors text-lg"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            {/* ── Listing context bar ──────────────────────────────────────── */}
            <div className="flex items-center gap-3 mx-5 mb-4 p-3 bg-[var(--color-surface-alt)] rounded-xl border border-[var(--color-border)]">
              {listing.imageUrl ? (
                <img src={listing.imageUrl} alt={listing.title} className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 bg-gray-200 rounded-lg flex-shrink-0 flex items-center justify-center text-xl">📦</div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--color-text)] truncate">{listing.title}</div>
                <div className="text-sm text-[var(--color-muted)]">
                  Precio: <span className="font-semibold text-[var(--color-accent)]">{formatOfferAmount(listing.price_cents, listing.currency)}</span>
                </div>
              </div>
            </div>

            {/* ── Success state ────────────────────────────────────────────── */}
            {step === 'success' && (
              <div className="px-5 pb-6 text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h3 className="font-bold text-lg mb-2">¡Oferta enviada!</h3>
                <p className="text-sm text-[var(--color-muted)] mb-2">
                  El vendedor tiene 48 horas para responder. Te avisaremos por correo.
                </p>
                <p className="text-xs text-[var(--color-muted)] mb-5">
                  Oferta: <strong>{amountInput && formatOfferAmount(offerCents, listing.currency)}</strong>
                </p>
                <button
                  type="button"
                  onClick={closeModal}
                  className="bg-[var(--color-accent)] text-white font-semibold py-2.5 px-8 rounded-lg text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  Entendido
                </button>
              </div>
            )}

            {/* ── Error state ──────────────────────────────────────────────── */}
            {step === 'error' && (
              <div className="px-5 pb-6 text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4 text-3xl">⚠️</div>
                <h3 className="font-bold text-lg mb-2">Algo salió mal</h3>
                <p className="text-sm text-red-600 mb-5">{errorMsg}</p>
                <button type="button" onClick={() => setStep('form')} className="text-sm text-[var(--color-accent)] underline">
                  Intentar de nuevo
                </button>
              </div>
            )}

            {/* ── Form ─────────────────────────────────────────────────────── */}
            {(step === 'form' || step === 'submitting') && (
              <div className="px-5 pb-5">

                {/* Anchor quick-select */}
                <div className="mb-4">
                  <p className="text-xs font-medium text-[var(--color-muted)] mb-2 uppercase tracking-wide">Selección rápida</p>
                  <div className="grid grid-cols-3 gap-2">
                    {OFFER_ANCHORS.map(({ pct, label }) => {
                      const cents = anchorAmount(listing.price_cents, pct)
                      const isSelected = selectedAnchor === pct
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => selectAnchor(pct)}
                          className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 transition-all ${
                            isSelected
                              ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,white)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-gray-50'
                          }`}
                        >
                          <span className={`text-sm font-bold ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                            {label}
                          </span>
                          <span className={`text-xs font-semibold mt-0.5 ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                            {formatOfferAmount(cents, listing.currency)}
                          </span>
                          <span className="text-[10px] text-[var(--color-muted)] mt-0.5">
                            ahorras {formatOfferAmount(listing.price_cents - cents, listing.currency)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Custom amount */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1.5">
                    O ingresa tu oferta
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted)] font-medium">$</span>
                    <input
                      ref={inputRef}
                      type="number"
                      inputMode="numeric"
                      value={amountInput}
                      onChange={e => handleAmountChange(e.target.value)}
                      placeholder={(listing.price_cents * 0.85 / 100).toFixed(0)}
                      min={1}
                      step={1}
                      className="w-full border border-[var(--color-border)] rounded-lg pl-7 pr-14 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-muted)]">
                      {listing.currency}
                    </span>
                  </div>

                  {/* Quality bar */}
                  {offerCents > 0 && offerCents < listing.price_cents && (
                    <QualityBar offerCents={offerCents} askingCents={listing.price_cents} />
                  )}

                  {/* Validation warnings */}
                  {fieldErrors.amount && (
                    <p className="text-red-600 text-xs mt-1.5">⚠ {fieldErrors.amount}</p>
                  )}
                  {!fieldErrors.amount && amountValidation?.level === 'warn' && (
                    <p className="text-amber-600 text-xs mt-1.5">⚠ {amountValidation.message}</p>
                  )}
                  {!fieldErrors.amount && amountValidation?.level === 'block' && offerCents > 0 && (
                    <p className="text-red-600 text-xs mt-1.5">⚠ {amountValidation.message}</p>
                  )}
                </div>

                {/* Optional message */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1.5">
                    Mensaje al vendedor
                    <span className="ml-1.5 text-xs font-normal text-[var(--color-muted)]">Opcional</span>
                  </label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Ej: &quot;¿Incluye cargador? ¿Aceptas meetup en Polanco?&quot;"
                    className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none"
                  />
                </div>

                {/* Buyer identity (hidden if pre-filled and non-empty) */}
                <div className={`space-y-3 mb-4 ${buyerInfo?.email ? 'hidden' : ''}`}>
                  <div>
                    <label className="block text-sm font-medium mb-1">Tu nombre</label>
                    <input
                      type="text"
                      value={buyerName}
                      onChange={e => { setBuyerName(e.target.value); setFieldErrors(p => ({ ...p, buyerName: '' })) }}
                      placeholder="Ana García"
                      className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    />
                    {fieldErrors.buyerName && <p className="text-red-600 text-xs mt-1">⚠ {fieldErrors.buyerName}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Tu correo electrónico</label>
                    <input
                      type="email"
                      value={buyerEmail}
                      onChange={e => { setBuyerEmail(e.target.value); setFieldErrors(p => ({ ...p, buyerEmail: '' })) }}
                      placeholder="ana@gmail.com"
                      className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    />
                    {fieldErrors.buyerEmail && <p className="text-red-600 text-xs mt-1">⚠ {fieldErrors.buyerEmail}</p>}
                    <p className="text-xs text-[var(--color-muted)] mt-1">Te avisaremos cuando el vendedor responda.</p>
                  </div>
                </div>
                {buyerInfo?.email && (
                  <div className="mb-4 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span className="text-green-600">✓</span>
                    Respuesta al correo: <strong>{buyerInfo.email}</strong>
                  </div>
                )}

                {/* Terms + expiry notice */}
                <div className="flex items-start gap-2 mb-4 p-3 bg-[var(--color-surface-alt)] rounded-lg border border-[var(--color-border)]">
                  <span className="text-sm mt-0.5">⏰</span>
                  <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                    Tu oferta expira en <strong>48 horas</strong> si el vendedor no responde.
                    Si aceptan, recibirás un enlace de pago por correo.
                  </p>
                </div>

                {/* Submit */}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={step === 'submitting' || (amountValidation?.level === 'block' && offerCents > 0)}
                  className="w-full bg-[var(--color-accent)] text-white font-semibold py-3 rounded-xl text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {step === 'submitting' ? (
                    <><span className="animate-spin">⟳</span> Enviando oferta…</>
                  ) : (
                    <>💬 Enviar oferta — {offerCents > 0 ? formatOfferAmount(offerCents, listing.currency) : '…'}</>
                  )}
                </button>

                <p className="text-center text-[10px] text-[var(--color-muted)] mt-2">
                  Sin comisiones · El vendedor responde en menos de 24h
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
