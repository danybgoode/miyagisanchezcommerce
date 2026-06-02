'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { startCheckout, type CheckoutFulfillmentMethod, type CheckoutProvider, type ManualSubType, type CheckoutShippingAddress, type CheckoutShippingQuote, type StartCheckoutResult } from '@/lib/cart'
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
  /** When provider is 'manual', the chosen structured sub-type. */
  manualSubType?: ManualSubType
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
  manualSubType,
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
  // Manual methods (SPEI/cash) complete the order immediately with no redirect —
  // we show inline instructions instead of leaving the page.
  const [manual, setManual] = useState<StartCheckoutResult | null>(null)

  const isManual = provider === 'manual' || provider === 'spei' || provider === 'cash'
  // Effective sub-type drives which instructions we show after the order is placed.
  const subType: ManualSubType = provider === 'spei' ? 'clabe' : provider === 'cash' ? 'cash' : (manualSubType ?? 'clabe')
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
        manualSubType: isManual ? subType : undefined,
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
      // Manual: order is registered. Show instructions.
      setManual(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar el pago.'
      setError(msg.includes('SELLER_NOT_CONNECTED') ? 'El vendedor aún no ha activado pagos en línea.' : msg)
    } finally {
      setLoading(false)
    }
  }

  // ── Manual confirmation (SPEI / cash) ─────────────────────────────────────
  if (manual) {
    const orderId = manual.cart_id
    const isOrder = orderId?.startsWith('order_')
    return (
      <div style={{ border: '1px solid var(--success, #16a34a)', background: 'var(--success-soft, #f0fdf4)', borderRadius: 12, padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="iconoir-check-circle" style={{ fontSize: 20, color: 'var(--success, #16a34a)' }} />
          <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--success-strong, #166534)' }}>
            {subType === 'cash' ? 'Pedido registrado — paga al recoger' : 'Pedido registrado — realiza tu pago'}
          </p>
        </div>

        {subType === 'clabe' && manual.clabe && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'grid', gap: 6 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: 600 }}>CLABE interbancaria</p>
            <p style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>{manual.clabe}</p>
            {manual.bank_name && <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Banco: <strong>{manual.bank_name}</strong></p>}
            {manual.account_holder && <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Beneficiario: <strong>{manual.account_holder}</strong></p>}
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Monto: <strong>{formatPrice(total, currency)}</strong></p>
            <button type="button" onClick={() => manual.clabe && navigator.clipboard?.writeText(manual.clabe)} style={{ justifySelf: 'start', fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
              Copiar CLABE
            </button>
          </div>
        )}

        {subType === 'dimo' && manual.dimo_phone && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'grid', gap: 6 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: 600 }}>DiMo — transfiere a este teléfono</p>
            <p style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>{manual.dimo_phone}</p>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Monto: <strong>{formatPrice(total, currency)}</strong></p>
          </div>
        )}

        <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          {subType === 'cash'
            ? 'El vendedor confirmará el pago cuando recibas el artículo y pagues en efectivo.'
            : 'Una vez recibido tu pago, el vendedor lo confirmará y procesará tu pedido.'}
        </p>

        {isOrder && (
          <button type="button" onClick={() => router.push(`/account/orders/${orderId}`)}
            className="w-full py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ border: '1px solid var(--success, #16a34a)', color: 'var(--success-strong, #166534)', background: 'transparent' }}>
            Ver mi pedido
          </button>
        )}
      </div>
    )
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
