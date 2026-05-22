'use client'

import { useState } from 'react'

interface SubscriptionSectionProps {
  listingId: string
  priceCents: number
  currency: string
  interval: 'month' | 'year'
  contentDescription: string | null
  shopName: string
  hasStripe: boolean       // seller has Stripe Connect active
  hasClabe: boolean        // seller has CLABE configured
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
  priceCents,
  currency,
  interval,
  contentDescription,
  shopName,
  hasStripe,
  hasClabe,
}: SubscriptionSectionProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // SPEI form state
  const [showSpei, setShowSpei] = useState(false)
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [speiResult, setSpeiResult] = useState<{ clabe: string | null; message: string } | null>(null)

  const priceLabel = `${formatPrice(priceCents, currency)}/${interval === 'year' ? 'año' : 'mes'}`

  async function handleStripeSubscribe() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/subscription-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error ?? 'No se pudo iniciar el pago. Inténtalo de nuevo.')
        return
      }
      window.location.href = data.url
    } catch {
      setError('Sin conexión. Verifica tu internet.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSpeiSubscribe(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/subscriptions/spei', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, buyerName, buyerEmail }),
      })
      const data = await res.json() as { clabe?: string; message?: string; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'No se pudo registrar la suscripción.')
        return
      }
      setSpeiResult({ clabe: data.clabe ?? null, message: data.message ?? '' })
    } catch {
      setError('Sin conexión. Verifica tu internet.')
    } finally {
      setLoading(false)
    }
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
            <p className="text-xs text-green-600 mt-1">Monto a transferir: <strong>{priceLabel}</strong></p>
          </div>
        )}
        <p className="text-xs text-green-600">
          El vendedor activará tu suscripción al confirmar el pago recibido.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-[var(--color-border)] rounded-xl p-5 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] font-medium mb-1">Suscripción a {shopName}</p>
        <p className="text-2xl font-bold text-[var(--color-text)]">{priceLabel}</p>
        {interval === 'year' && (
          <p className="text-xs text-green-600 font-medium mt-0.5">
            💰 Equivale a {formatPrice(Math.round(priceCents / 12), currency)}/mes — ahorra al pagar anual
          </p>
        )}
      </div>

      {/* Benefits */}
      {contentDescription && (
        <div className="bg-[var(--color-background)] rounded-lg p-3">
          <p className="text-xs font-semibold text-[var(--color-text)] mb-1">¿Qué incluye?</p>
          <p className="text-sm text-[var(--color-muted)] whitespace-pre-line">{contentDescription}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-red-600 text-sm flex items-center gap-1.5">
          <span>⚠</span> {error}
        </p>
      )}

      {!showSpei ? (
        <div className="space-y-2">
          {/* Stripe button */}
          {hasStripe && (
            <button
              type="button"
              onClick={handleStripeSubscribe}
              disabled={loading}
              className="w-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Cargando…' : `Suscribirme — ${priceLabel}`}
            </button>
          )}

          {/* SPEI option */}
          {hasClabe && (
            <button
              type="button"
              onClick={() => setShowSpei(true)}
              className="w-full border border-[var(--color-border)] text-[var(--color-text)] font-medium py-2.5 rounded-lg text-sm hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
            >
              💳 Pagar con SPEI / transferencia bancaria
            </button>
          )}

          {!hasStripe && !hasClabe && (
            <div className="text-center py-2">
              <p className="text-sm text-[var(--color-muted)]">
                El vendedor aún no ha configurado los pagos en línea.
              </p>
              <p className="text-xs text-[var(--color-muted)] mt-1">Contáctalo directamente para suscribirte.</p>
            </div>
          )}

          <p className="text-xs text-center text-[var(--color-muted)]">
            Cancela cuando quieras · Sin compromisos
          </p>
        </div>
      ) : (
        /* SPEI form */
        <form onSubmit={handleSpeiSubscribe} className="space-y-3">
          <p className="text-sm font-medium text-[var(--color-text)]">Regístra tu suscripción SPEI</p>
          <input
            type="text"
            value={buyerName}
            onChange={e => setBuyerName(e.target.value)}
            placeholder="Tu nombre completo"
            required
            minLength={2}
            className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
          />
          <input
            type="email"
            value={buyerEmail}
            onChange={e => setBuyerEmail(e.target.value)}
            placeholder="Tu correo electrónico"
            required
            className="w-full border border-[var(--color-border)] rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowSpei(false); setError(null) }}
              className="flex-1 border border-[var(--color-border)] text-[var(--color-text)] py-2.5 rounded-lg text-sm font-medium hover:bg-[var(--color-background)] transition-colors"
            >
              ← Atrás
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
            >
              {loading ? 'Registrando…' : 'Confirmar'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
