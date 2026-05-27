'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { startCheckout } from '@/lib/cart'

interface MercadoPagoButtonProps {
  listingId: string
  price: string
  buyerEmail?: string
  /** Accepted offer override in centavos (optional) */
  offerAmountCents?: number
  /** Supabase offer ID for webhook reconciliation (optional) */
  offerId?: string
  isSignedIn: boolean
}

export default function MercadoPagoButton({
  listingId,
  price,
  buyerEmail,
  offerAmountCents,
  offerId,
  isSignedIn,
}: MercadoPagoButtonProps) {
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
        style={{ background: '#009EE3', color: '#fff' }}
      >
        <i className="iconoir-log-in" style={{ fontSize: 16 }} />
        Inicia sesión para pagar con Mercado Pago
      </a>
    )
  }

  async function handlePay() {
    setLoading(true)
    setError(null)
    try {
      const clerkJwt = (await getToken()) ?? undefined
      const { redirect_url } = await startCheckout({
        productId: listingId,
        provider: 'mercadopago',
        buyerEmail: buyerEmail ?? user?.primaryEmailAddress?.emailAddress,
        buyerFirstName: user?.firstName ?? undefined,
        buyerLastName: user?.lastName ?? undefined,
        offerAmountCents,
        offerId,
        clerkJwt,
      })
      window.location.href = redirect_url
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar el pago.'
      setError(msg)
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
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm disabled:opacity-60 transition-colors"
        style={{ background: '#009EE3', color: '#fff' }}
      >
        {loading ? (
          <span className="animate-spin inline-block">⟳</span>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="16" fill="#fff" fillOpacity=".2"/>
              <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">MP</text>
            </svg>
            Pagar con Mercado Pago — {price}
          </>
        )}
      </button>
      {error && <p className="text-[var(--danger)] text-xs mt-2 text-center">⚠ {error}</p>}
      <p className="text-xs text-center text-[var(--fg-muted)] mt-1.5">
        Tarjeta · OXXO · Wallet · Meses sin intereses
      </p>
    </div>
  )
}
