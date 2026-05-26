'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

interface BuyButtonProps {
  listingId: string
  price: string
  isDigital?: boolean
  sellerHasStripe: boolean
  isSignedIn: boolean
}

export default function BuyButton({ listingId, price, isDigital, sellerHasStripe, isSignedIn }: BuyButtonProps) {
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sellerHasStripe) {
    return (
      <p className="text-xs text-[var(--fg-muted)] text-center py-2">
        El vendedor aún no ha activado pagos en línea.
      </p>
    )
  }

  if (!isSignedIn) {
    return (
      <a
        href={`/sign-in?redirect_url=${encodeURIComponent(pathname)}`}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
        style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
      >
        <i className="iconoir-log-in" style={{ fontSize: 16 }} />
        Inicia sesión para comprar
      </a>
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
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm disabled:opacity-60 transition-colors"
        style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
      >
        {loading ? (
          <span className="animate-spin inline-block">⟳</span>
        ) : (
          <>{isDigital ? 'Comprar y descargar' : 'Comprar ahora'} — {price}</>
        )}
      </button>
      {error && <p className="text-[var(--danger)] text-xs mt-2 text-center">⚠ {error}</p>}
      <p className="text-xs text-center text-[var(--fg-muted)] mt-1.5">
        Pago seguro con Stripe · 0% comisión
      </p>
    </div>
  )
}
