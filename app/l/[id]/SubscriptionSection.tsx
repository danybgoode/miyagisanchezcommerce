'use client'

import { useState } from 'react'

export interface SubscriptionTier {
  id: string
  label: string
  price_cents: number
  interval: 'month' | 'year'
  features: string[]
  is_highlighted: boolean
  stripe_price_id?: string
  mp_preapproval_plan_id?: string
}

interface SubscriptionSectionProps {
  listingId: string
  tiers: SubscriptionTier[]
  shopName: string
  hasStripe: boolean   // seller has Stripe Connect active
  hasClabe: boolean    // seller has CLABE configured
  hasMp: boolean       // seller has MercadoPago enabled
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export default function SubscriptionSection({
  listingId,
  tiers,
  shopName,
  hasStripe,
  hasClabe,
  hasMp,
}: SubscriptionSectionProps) {
  const [selectedTierId, setSelectedTierId] = useState(
    tiers.find(t => t.is_highlighted)?.id ?? tiers[0]?.id ?? '',
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // SPEI form state
  const [showSpei, setShowSpei] = useState(false)
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [speiResult, setSpeiResult] = useState<{ clabe: string | null; message: string } | null>(null)

  const selectedTier = tiers.find(t => t.id === selectedTierId) ?? tiers[0]
  const currency = 'MXN'

  function tierLabel(tier: SubscriptionTier) {
    return `${formatPrice(tier.price_cents, currency)}/${tier.interval === 'year' ? 'año' : 'mes'}`
  }

  async function handleStripeSubscribe() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/stripe/subscription-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, tierId: selectedTierId }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) { setError(data.error ?? 'Error al iniciar el pago.'); return }
      window.location.href = data.url
    } catch { setError('Sin conexión. Verifica tu internet.') }
    finally { setLoading(false) }
  }

  async function handleMpSubscribe() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/mp/subscription-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, tierId: selectedTierId }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) { setError(data.error ?? 'Error al iniciar el pago.'); return }
      window.location.href = data.url
    } catch { setError('Sin conexión. Verifica tu internet.') }
    finally { setLoading(false) }
  }

  async function handleSpeiSubscribe(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null)
    try {
      const res = await fetch('/api/subscriptions/spei', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, tierId: selectedTierId, buyerName, buyerEmail }),
      })
      const data = await res.json() as { clabe?: string; message?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'No se pudo registrar la suscripción.'); return }
      setSpeiResult({ clabe: data.clabe ?? null, message: data.message ?? '' })
    } catch { setError('Sin conexión. Verifica tu internet.') }
    finally { setLoading(false) }
  }

  if (speiResult) {
    return (
      <div className="border border-green-200 bg-green-50 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✅</span>
          <p className="font-semibold text-green-800">¡Suscripción registrada!</p>
        </div>
        <p className="text-sm text-green-700">{speiResult.message}</p>
        {speiResult.clabe && (
          <div className="bg-white border border-green-200 rounded-lg p-3">
            <p className="text-xs text-green-600 font-medium mb-1">CLABE interbancaria del vendedor:</p>
            <p className="font-mono text-lg font-bold text-green-900 tracking-wider">{speiResult.clabe}</p>
            <p className="text-xs text-green-600 mt-1">Monto: <strong>{selectedTier ? tierLabel(selectedTier) : ''}</strong></p>
          </div>
        )}
        <p className="text-xs text-green-600">El vendedor activará tu suscripción al confirmar el pago.</p>
      </div>
    )
  }

  return (
    <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] font-medium mb-1">
          Suscripción a {shopName}
        </p>
      </div>

      {/* Tier cards */}
      {tiers.length > 0 && (
        <div className={`px-4 pb-4 grid gap-3 ${tiers.length === 1 ? 'grid-cols-1' : tiers.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {tiers.map(tier => {
            const isSelected = tier.id === selectedTierId
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => setSelectedTierId(tier.id)}
                className={`relative border rounded-xl p-3 text-left transition-all ${
                  isSelected
                    ? 'border-[var(--color-accent)] bg-green-50 ring-2 ring-[var(--color-accent)] ring-offset-1'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                }`}
              >
                {tier.is_highlighted && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[var(--color-accent)] text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                    Popular
                  </span>
                )}
                <p className="font-semibold text-sm text-[var(--color-text)] leading-tight">{tier.label || `Plan ${tiers.indexOf(tier) + 1}`}</p>
                <p className="text-lg font-bold text-[var(--color-accent)] mt-1 leading-tight">
                  {formatPrice(tier.price_cents, currency)}
                  <span className="text-xs font-normal text-[var(--color-muted)]">/{tier.interval === 'year' ? 'año' : 'mes'}</span>
                </p>
                {tier.interval === 'year' && (
                  <p className="text-[10px] text-green-600 mt-0.5">
                    ≈ {formatPrice(Math.round(tier.price_cents / 12), currency)}/mes
                  </p>
                )}
                {tier.features.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {tier.features.slice(0, 4).map((f, i) => (
                      <li key={i} className="text-xs text-[var(--color-text)] flex items-start gap-1">
                        <span className="text-[var(--color-accent)] shrink-0 mt-0.5">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                    {tier.features.length > 4 && (
                      <li className="text-xs text-[var(--color-muted)]">+{tier.features.length - 4} más…</li>
                    )}
                  </ul>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* CTA area */}
      <div className="px-5 pb-5 space-y-2">
        {error && (
          <p className="text-red-600 text-sm flex items-center gap-1.5">
            <span>⚠</span> {error}
          </p>
        )}

        {!showSpei ? (
          <>
            {hasStripe && (
              <button
                type="button"
                onClick={handleStripeSubscribe}
                disabled={loading}
                className="w-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-60"
              >
                {loading ? 'Cargando…' : `Suscribirme — ${selectedTier ? tierLabel(selectedTier) : ''}`}
              </button>
            )}

            {hasMp && (
              <button
                type="button"
                onClick={handleMpSubscribe}
                disabled={loading}
                className="w-full bg-[#009EE3] hover:bg-[#0087c3] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <svg width="18" height="18" viewBox="0 0 32 32" fill="currentColor">
                  <path d="M28 16a12 12 0 1 1-24 0 12 12 0 0 1 24 0zm-14.7 4.4 7.6-4.4-7.6-4.4v8.8z"/>
                </svg>
                {loading ? 'Cargando…' : 'Suscribirme con MercadoPago'}
              </button>
            )}

            {hasClabe && (
              <button
                type="button"
                onClick={() => setShowSpei(true)}
                className="w-full border border-[var(--color-border)] text-[var(--color-text)] font-medium py-2.5 rounded-lg text-sm hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
              >
                💳 Pagar con SPEI / transferencia bancaria
              </button>
            )}

            {!hasStripe && !hasMp && !hasClabe && (
              <div className="text-center py-2">
                <p className="text-sm text-[var(--color-muted)]">El vendedor aún no ha configurado los pagos en línea.</p>
              </div>
            )}

            <p className="text-xs text-center text-[var(--color-muted)]">Cancela cuando quieras · Sin compromisos</p>
          </>
        ) : (
          <form onSubmit={handleSpeiSubscribe} className="space-y-3">
            <p className="text-sm font-medium text-[var(--color-text)]">Registra tu suscripción SPEI</p>
            <input type="text" value={buyerName} onChange={e => setBuyerName(e.target.value)}
              placeholder="Tu nombre completo" required minLength={2}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
            <input type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)}
              placeholder="Tu correo electrónico" required
              className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowSpei(false); setError(null) }}
                className="flex-1 border border-[var(--color-border)] text-[var(--color-text)] py-2.5 rounded-lg text-sm font-medium hover:bg-[var(--color-background)] transition-colors">
                ← Atrás
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60">
                {loading ? 'Registrando…' : 'Confirmar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
