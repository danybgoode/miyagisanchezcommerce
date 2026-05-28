'use client'

import { useState } from 'react'
import { useAuth, useUser } from '@clerk/nextjs'
import { startCheckout, type CheckoutFulfillmentMethod, type CheckoutProvider, type CheckoutShippingAddress } from '@/lib/cart'
import type { CartItem } from './CartContext'

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

interface CheckoutPayButtonProps {
  provider: CheckoutProvider
  listingId?: string
  items?: CartItem[]
  sellerId?: string
  amountCents: number
  currency: string
  offerId?: string
  offerAmountCents?: number
  fulfillmentMethod?: CheckoutFulfillmentMethod
  pickupSpotId?: string
  shippingAddress?: CheckoutShippingAddress
  disabled?: boolean
  onStarted?: () => void
}

export default function CheckoutPayButton({
  provider,
  listingId,
  items,
  sellerId,
  amountCents,
  currency,
  offerId,
  offerAmountCents,
  fulfillmentMethod,
  pickupSpotId,
  shippingAddress,
  disabled,
  onStarted,
}: CheckoutPayButtonProps) {
  const { getToken } = useAuth()
  const { user } = useUser()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setLoading(true)
    setError(null)
    try {
      const buyerEmail = user?.primaryEmailAddress?.emailAddress
      const clerkJwt = (await getToken()) ?? undefined
      const { redirect_url } = await startCheckout({
        productId: listingId,
        items: items?.map(item => ({ productId: item.productId, variantId: item.variantId })),
        sellerId,
        provider,
        buyerEmail,
        buyerFirstName: user?.firstName ?? undefined,
        buyerLastName: user?.lastName ?? undefined,
        offerAmountCents,
        offerId,
        clerkJwt,
        fulfillmentMethod,
        pickupSpotId,
        shippingAddress,
      })
      onStarted?.()
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
        onClick={pay}
        disabled={disabled || loading}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm disabled:opacity-60 transition-colors"
        style={{ background: provider === 'mercadopago' ? '#009EE3' : 'var(--fg)', color: provider === 'mercadopago' ? '#fff' : 'var(--fg-inverse)', border: 'none' }}
      >
        {loading ? (
          <span className="animate-spin inline-block">⟳</span>
        ) : (
          <>
            {provider === 'mercadopago' ? 'Pagar con Mercado Pago' : 'Pagar con tarjeta'} — {formatPrice(amountCents, currency)}
          </>
        )}
      </button>
      {error && <p className="text-[var(--danger)] text-xs mt-2 text-center">⚠ {error}</p>}
    </div>
  )
}
