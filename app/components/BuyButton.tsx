'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { startCheckout } from '@/lib/cart'
import { signInHopHref } from '@/lib/checkout-hop'

interface BuyButtonProps {
  listingId: string
  price: string
  isDigital?: boolean
  sellerHasStripe: boolean
  isSignedIn: boolean
  buyerEmail?: string
  /** Accepted offer override in centavos (optional) */
  offerAmountCents?: number
  /** Supabase offer ID for webhook reconciliation (optional) */
  offerId?: string
  /** Tenant custom domain when rendered on an own-channel storefront (else null). */
  customDomain?: string | null
}

export default function BuyButton({
  listingId,
  price,
  isDigital,
  sellerHasStripe,
  isSignedIn,
  buyerEmail,
  offerAmountCents,
  offerId,
  customDomain,
}: BuyButtonProps) {
  const pathname = usePathname()
  const { getToken } = useAuth()
  const { user } = useUser()
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
    // On a custom domain, hop to the platform sign-in → platform checkout for
    // this listing (Clerk can't run on the tenant domain). On the platform,
    // unchanged: sign in and come back to this page.
    const signInHref = customDomain
      ? signInHopHref(`/checkout?listingId=${listingId}`, customDomain)
      : `/sign-in?redirect_url=${encodeURIComponent(pathname)}`
    return (
      <a
        href={signInHref}
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
      const clerkJwt = (await getToken()) ?? undefined
      const { redirect_url } = await startCheckout({
        productId: listingId,
        provider: 'stripe',
        buyerEmail: buyerEmail ?? user?.primaryEmailAddress?.emailAddress,
        buyerFirstName: user?.firstName ?? undefined,
        buyerLastName: user?.lastName ?? undefined,
        offerAmountCents,
        offerId,
        clerkJwt,
      })
      if (redirect_url) window.location.href = redirect_url
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar el pago.'
      // Surface seller-not-connected error in friendlier Spanish
      if (msg.includes('SELLER_NOT_CONNECTED') || msg.includes('activado los pagos')) {
        setError('Este vendedor aún no ha activado pagos en línea. Contáctalo directamente.')
      } else {
        setError(msg)
      }
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
