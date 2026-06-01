'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { CheckoutProvider } from '@/lib/cart'
import { formatOfferAmount } from '@/lib/offers'

interface OfferCheckoutButtonProps {
  listingId: string
  offerId: string
  amountCents: number
  currency: string
  /** Optional pre-selected provider. Omit so the checkout page lets the buyer choose. */
  provider?: CheckoutProvider
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
  const router = useRouter()
  const [loading, setLoading] = useState(false)

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
    const providerParam = provider ? `&provider=${provider}` : ''
    router.push(`/checkout?listingId=${encodeURIComponent(listingId)}&offerId=${encodeURIComponent(offerId)}${providerParam}`)
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
    </div>
  )
}
