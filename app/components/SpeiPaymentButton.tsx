'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { startCheckout, type CheckoutFulfillmentMethod } from '@/lib/cart'

interface SpeiPaymentButtonProps {
  listingId: string
  sellerId?: string
  amountCents: number
  currency: string
  isSignedIn: boolean
  fulfillmentMethod?: CheckoutFulfillmentMethod
  offerId?: string
  offerAmountCents?: number
}

type Step = 'idle' | 'loading' | 'instructions' | 'error'

export default function SpeiPaymentButton({
  listingId,
  sellerId,
  amountCents,
  currency,
  isSignedIn,
  fulfillmentMethod,
  offerId,
  offerAmountCents,
}: SpeiPaymentButtonProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { getToken } = useAuth()
  const { user } = useUser()
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [clabe, setClabe] = useState<string | null>(null)
  const [bankName, setBankName] = useState<string | null>(null)
  const [accountHolder, setAccountHolder] = useState<string | null>(null)

  const formattedAmount = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency ?? 'MXN',
    maximumFractionDigits: 0,
  }).format((offerAmountCents ?? amountCents) / 100)

  if (!isSignedIn) {
    return (
      <a
        href={`/sign-in?redirect_url=${encodeURIComponent(pathname)}`}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors border border-[var(--color-border)]"
        style={{ background: 'var(--bg)', color: 'var(--fg)' }}
      >
        <i className="iconoir-log-in" style={{ fontSize: 16 }} />
        Inicia sesión para pagar con SPEI
      </a>
    )
  }

  async function handlePay() {
    setStep('loading')
    setError(null)
    try {
      const clerkJwt = (await getToken()) ?? undefined
      const result = await startCheckout({
        productId: listingId,
        sellerId,
        provider: 'spei',
        buyerEmail: user?.primaryEmailAddress?.emailAddress,
        buyerFirstName: user?.firstName ?? undefined,
        buyerLastName: user?.lastName ?? undefined,
        offerAmountCents,
        offerId,
        clerkJwt,
        fulfillmentMethod,
      })
      // result.cart_id is actually the order ID after startCheckout completes the cart
      setOrderId(result.cart_id ?? null)
      setClabe(result.clabe ?? null)
      setBankName(result.bank_name ?? null)
      setAccountHolder(result.account_holder ?? null)
      setStep('instructions')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar el pago.'
      setError(msg)
      setStep('error')
    }
  }

  if (step === 'instructions') {
    return (
      <div className="border border-green-200 rounded-xl p-4 bg-green-50 space-y-3">
        <div className="flex items-center gap-2">
          <i className="iconoir-check-circle text-green-600" style={{ fontSize: 20 }} />
          <p className="text-sm font-semibold text-green-800">Pedido registrado — realiza tu transferencia</p>
        </div>

        <div className="bg-white rounded-lg border border-green-200 p-3 space-y-2">
          <p className="text-xs text-gray-500 uppercase font-medium">CLABE interbancaria</p>
          <p className="font-mono text-xl font-bold text-gray-900 tracking-wider">{clabe}</p>
          {bankName && <p className="text-xs text-gray-600">Banco: <strong>{bankName}</strong></p>}
          {accountHolder && <p className="text-xs text-gray-600">Beneficiario: <strong>{accountHolder}</strong></p>}
          <p className="text-xs text-gray-600">
            Monto: <strong>{formattedAmount}</strong>
          </p>
          <button
            type="button"
            onClick={() => clabe && navigator.clipboard?.writeText(clabe)}
            className="text-xs text-blue-600 hover:underline"
          >
            Copiar CLABE
          </button>
        </div>

        <p className="text-xs text-gray-600">
          Una vez recibida la transferencia, el vendedor confirmará el pago y procesará tu pedido.
        </p>

        {orderId && orderId.startsWith('order_') && (
          <button
            type="button"
            onClick={() => router.push(`/account/orders/${orderId}`)}
            className="w-full py-2 rounded-lg border border-green-600 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors"
          >
            Ver mi pedido
          </button>
        )}
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div>
        <button
          type="button"
          onClick={() => setStep('idle')}
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm border border-[var(--color-border)]"
          style={{ background: 'var(--bg)', color: 'var(--fg)' }}
        >
          <i className="iconoir-bank" style={{ fontSize: 16 }} />
          Pagar con SPEI — {formattedAmount}
        </button>
        {error && <p className="text-red-600 text-xs mt-2 text-center">⚠ {error}</p>}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={handlePay}
        disabled={step === 'loading'}
        className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm disabled:opacity-60 transition-colors border border-[var(--color-border)]"
        style={{ background: 'var(--bg)', color: 'var(--fg)' }}
      >
        {step === 'loading' ? (
          <span className="animate-spin inline-block">⟳</span>
        ) : (
          <>
            <i className="iconoir-bank" style={{ fontSize: 16 }} />
            Pagar con SPEI — {formattedAmount}
          </>
        )}
      </button>
      {step === 'idle' && (
        <p className="text-xs text-center text-[var(--fg-muted)] mt-1.5">
          Transferencia bancaria · CLABE interbancaria
        </p>
      )}
    </div>
  )
}
