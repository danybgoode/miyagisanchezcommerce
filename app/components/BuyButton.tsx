'use client'

import { useState } from 'react'

interface BuyButtonProps {
  listingId: string
  price: string
  isDigital?: boolean
  sellerHasStripe: boolean
}

export default function BuyButton({ listingId, price, isDigital, sellerHasStripe }: BuyButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sellerHasStripe) {
    return (
      <p className="text-xs text-[var(--color-muted)] text-center py-2">
        El vendedor aún no ha activado pagos en línea.
      </p>
    )
  }

  async function handleBuy() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error ?? 'No se pudo iniciar el pago.')
        return
      }
      window.location.href = data.url
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
        onClick={handleBuy}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full bg-[var(--color-accent)] text-white font-semibold py-3 rounded-lg text-sm disabled:opacity-60 hover:bg-[var(--color-accent-hover)] transition-colors"
      >
        {loading ? (
          <span className="animate-spin">⟳</span>
        ) : (
          <>{isDigital ? '💳 Comprar y descargar' : '💳 Comprar ahora'} — {price}</>
        )}
      </button>
      {error && (
        <p className="text-red-600 text-xs mt-2 text-center">⚠ {error}</p>
      )}
      <p className="text-xs text-center text-[var(--color-muted)] mt-1.5">
        Pago seguro con Stripe · 0% comisión
      </p>
    </div>
  )
}
