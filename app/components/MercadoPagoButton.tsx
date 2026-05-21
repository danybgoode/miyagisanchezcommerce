'use client'

import { useState } from 'react'

interface MercadoPagoButtonProps {
  listingId: string
  price: string
  buyerEmail?: string
  offerId?: string
}

export default function MercadoPagoButton({ listingId, price, buyerEmail, offerId }: MercadoPagoButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handlePay() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/mp/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, buyerEmail, offerId }),
      })
      const data = await res.json() as { checkoutUrl?: string; error?: string }
      if (!res.ok || !data.checkoutUrl) {
        setError(data.error ?? 'No se pudo iniciar el pago.')
        return
      }
      window.location.href = data.checkoutUrl
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handlePay}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-lg text-sm disabled:opacity-60 transition-colors"
        style={{ background: '#009EE3', color: '#fff' }}
      >
        {loading ? (
          <span className="animate-spin">⟳</span>
        ) : (
          <>
            {/* MercadoPago wordmark SVG — inline so no external request */}
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="16" fill="#fff" fillOpacity=".2"/>
              <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">MP</text>
            </svg>
            Pagar con Mercado Pago — {price}
          </>
        )}
      </button>
      {error && (
        <p className="text-red-600 text-xs mt-2 text-center">⚠ {error}</p>
      )}
      <p className="text-xs text-center text-[var(--color-muted)] mt-1.5">
        Tarjeta · OXXO · Wallet · Meses sin intereses
      </p>
    </div>
  )
}
