'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { startCheckout, type CheckoutFulfillmentMethod, type CheckoutProvider, type CheckoutShippingAddress, type CheckoutShippingQuote } from '@/lib/cart'
import type { CartItem } from './CartContext'

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

const PAY_LABEL: Record<CheckoutProvider, string> = {
  mercadopago: 'Pagar con Mercado Pago',
  stripe: 'Pagar con tarjeta',
  spei: 'Pagar con SPEI',
  cash: 'Confirmar pedido',
  manual: 'Confirmar pedido',
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
  shippingQuote?: CheckoutShippingQuote
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
  shippingQuote,
  disabled,
  onStarted,
}: CheckoutPayButtonProps) {
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isManual = provider === 'manual' || provider === 'spei' || provider === 'cash'
  const total = amountCents + (shippingQuote?.amountCents ?? 0)

  async function pay() {
    setLoading(true)
    setError(null)
    try {
      const buyerEmail = user?.primaryEmailAddress?.emailAddress
      const clerkJwt = (await getToken()) ?? undefined
      const result = await startCheckout({
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
        shippingQuote,
      })
      onStarted?.()
      if (result.redirect_url) {
        window.location.href = result.redirect_url
        return
      }
      // Manual: order is registered → go to the dedicated order page, which shows
      // all the seller's payment instructions and the pending-payment state.
      if (result.cart_id?.startsWith('order_')) {
        router.push(`/account/orders/${result.cart_id}`)
        return
      }
      setError('No se pudo registrar el pedido. Intenta de nuevo.')
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
        style={{
          background: provider === 'mercadopago' ? '#009EE3' : isManual ? 'var(--bg-elevated)' : 'var(--fg)',
          color: provider === 'mercadopago' ? '#fff' : isManual ? 'var(--fg)' : 'var(--fg-inverse)',
          border: isManual ? '1.5px solid var(--border)' : 'none',
        }}
      >
        {loading ? (
          <span className="animate-spin inline-block">⟳</span>
        ) : (
          <>{PAY_LABEL[provider]} — {formatPrice(total, currency)}</>
        )}
      </button>
      {error && <p className="text-[var(--danger)] text-xs mt-2 text-center">⚠ {error}</p>}
    </div>
  )
}
