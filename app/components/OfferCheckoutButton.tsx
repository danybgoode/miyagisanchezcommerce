'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { startCheckout, type CheckoutProvider } from '@/lib/cart'
import { formatOfferAmount } from '@/lib/offers'

interface OfferCheckoutButtonProps {
  listingId: string
  offerId: string
  amountCents: number
  currency: string
  provider: CheckoutProvider
  isSignedIn: boolean
  label?: string
  variant?: 'primary' | 'accent'
}

export default function OfferCheckoutButton({
  listingId,
  offerId,
  amountCents,
  currency,
  provider,
  isSignedIn,
  label = 'Comprar ahora',
  variant = 'primary',
}: OfferCheckoutButtonProps) {
  const pathname = usePathname()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isSignedIn) {
    return (
      <a
        href={`/sign-in?redirect_url=${encodeURIComponent(pathname)}`}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <i className="iconoir-log-in" style={{ fontSize: 16 }} />
        Inicia sesión para comprar
      </a>
    )
  }

  async function checkout() {
    setLoading(true)
    setError(null)
    try {
      const clerkJwt = (await getToken()) ?? undefined
      const { redirect_url } = await startCheckout({
        productId: listingId,
        provider,
        buyerEmail: user?.primaryEmailAddress?.emailAddress,
        buyerFirstName: user?.firstName ?? undefined,
        buyerLastName: user?.lastName ?? undefined,
        offerAmountCents: amountCents,
        offerId,
        clerkJwt,
      })
      window.location.href = redirect_url
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar el pago.'
      setError(msg.includes('SELLER_NOT_CONNECTED') ? 'El vendedor aún no ha activado pagos en línea.' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={checkout}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm disabled:opacity-60 transition-colors"
        style={{
          background: variant === 'accent' ? 'var(--accent)' : 'var(--fg)',
          color: variant === 'accent' ? '#fff' : 'var(--fg-inverse)',
          border: 'none',
        }}
      >
        {loading ? (
          <span className="animate-spin inline-block">⟳</span>
        ) : (
          <>{label} — {formatOfferAmount(amountCents, currency)}</>
        )}
      </button>
      {error && <p className="text-[var(--danger)] text-xs mt-2 text-center">⚠ {error}</p>}
    </div>
  )
}
