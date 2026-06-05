'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { CheckoutProvider } from '@/lib/cart'
import { formatOfferAmount } from '@/lib/offers'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'

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
  /** Tenant custom domain when rendered on an own-channel storefront (else null). */
  customDomain?: string | null
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
  customDomain = null,
}: OfferCheckoutButtonProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const providerParam = provider ? `&provider=${provider}` : ''
  const checkoutPath = `/checkout?listingId=${encodeURIComponent(listingId)}&offerId=${encodeURIComponent(offerId)}${providerParam}`

  if (!isSignedIn) {
    // On a custom domain, hop to the platform sign-in → platform checkout for
    // this offer (Clerk can't run on the tenant domain).
    const signInHref = customDomain
      ? signInHopHref(checkoutPath, customDomain)
      : `/sign-in?redirect_url=${encodeURIComponent(pathname)}`
    return (
      <a
        href={signInHref}
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
    // On a custom domain, hop to the platform checkout (absolute); else stay in-app.
    if (customDomain) window.location.href = checkoutHopHref(checkoutPath, customDomain)
    else router.push(checkoutPath)
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
