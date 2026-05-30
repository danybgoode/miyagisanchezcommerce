/**
 * /payment/success
 *
 * Handles two flows:
 *   - New Medusa flow:  ?cart_id=cart_xxx  (from start-checkout success_url)
 *     Also supports MP extra params: &payment_id=xxx&status=approved
 *   - Legacy Stripe flow: ?session_id=cs_xxx (backwards compat)
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'

export const metadata = { title: 'Pago completado — Miyagi Sánchez' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

async function completeMedusaCart(cartId: string): Promise<{ type?: string; order?: Record<string, unknown> } | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/carts/${cartId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
      },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function authorizeMpPayment(cartId: string, mpPaymentId: string): Promise<void> {
  try {
    await fetch(`${MEDUSA_BASE}/store/carts/${cartId}/mp-authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-publishable-api-key': MEDUSA_PUB_KEY,
      },
      body: JSON.stringify({ mp_payment_id: mpPaymentId }),
      cache: 'no-store',
    })
  } catch {
    // non-fatal — webhook may have already done this
  }
}

/** Seller/shop name for the post-purchase summary (channel-agnostic listings endpoint). */
async function getListingSellerName(productId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${productId}`, {
      headers: { 'x-publishable-api-key': MEDUSA_PUB_KEY },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const { listing } = await res.json()
    return listing?.seller?.name ?? listing?.shop?.name ?? null
  } catch {
    return null
  }
}

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams

  // ── New Medusa flow ──────────────────────────────────────────────────────
  if (params.cart_id) {
    const cartId = params.cart_id

    // MP appends payment_id + status to the success URL
    const mpPaymentId = params.payment_id
    const mpStatus = params.status

    // If MP payment_id is present and approved, authorize the session first
    if (mpPaymentId && mpStatus === 'approved') {
      await authorizeMpPayment(cartId, mpPaymentId)
    }

    // Complete the cart → creates Medusa order (idempotent if already done by webhook)
    const result = await completeMedusaCart(cartId)
    const order = result?.order as Record<string, unknown> | undefined

    const productId = (order?.items as Array<Record<string, unknown>> | undefined)?.[0]?.product_id as string | undefined
    const itemName = (order?.items as Array<Record<string, unknown>> | undefined)?.[0]?.title as string ?? 'tu compra'
    const amountTotal = order?.total as number | undefined
    const currency = order?.currency_code as string ?? 'MXN'
    const amountPaid = amountTotal
      ? new Intl.NumberFormat('es-MX', {
          style: 'currency',
          currency: currency.toUpperCase(),
          maximumFractionDigits: 0,
        }).format(amountTotal / 100)
      : null

    // Human-friendly order number (Medusa display_id) + seller name for the summary.
    const orderNumber = order?.display_id != null ? `#${order.display_id}` : null
    const sellerName = productId ? await getListingSellerName(productId) : null

    return <SuccessUI
      buyerName={null}
      amountPaid={amountPaid}
      itemName={itemName}
      orderNumber={orderNumber}
      sellerName={sellerName}
      listingId={productId ?? null}
      isDigital={false}
      provider={mpPaymentId ? 'mercadopago' : 'stripe'}
    />
  }

  // ── Legacy Stripe flow ───────────────────────────────────────────────────
  const { session_id } = params
  if (!session_id) redirect('/')

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>> | null = null
  try {
    session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items'],
    })
  } catch {
    redirect('/')
  }

  const listingId = session!.metadata?.listing_id
  const listingType = session!.metadata?.listing_type

  // Fetch order for digital download URL (legacy Supabase orders)
  const { data: order } = listingId ? await db
    .from('marketplace_orders')
    .select('id, status, digital_download_url, digital_download_expires_at')
    .eq('stripe_session_id', session_id)
    .maybeSingle() : { data: null }

  const buyerName = session!.customer_details?.name?.split(' ')[0] ?? null
  const amountPaid = session!.amount_total
    ? new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: session!.currency?.toUpperCase() ?? 'MXN',
        maximumFractionDigits: 0,
      }).format(session!.amount_total / 100)
    : null

  const itemName = session!.line_items?.data?.[0]?.description
    ?? session!.line_items?.data?.[0]?.price?.nickname
    ?? 'tu compra'

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <CheckIcon />
        <h1 className="text-2xl font-bold mb-2">
          {buyerName ? `¡Gracias, ${buyerName}!` : '¡Pago completado!'}
        </h1>
        {amountPaid && (
          <p className="text-[var(--color-muted)] mb-6">
            Pagaste <strong className="text-[var(--color-foreground)]">{amountPaid}</strong> por {itemName}.
          </p>
        )}

        {listingType === 'digital' && (
          <div className="border border-blue-200 bg-blue-50 rounded-xl p-5 mb-6 text-left">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📥</span>
              <span className="font-semibold text-blue-800">Entrega digital</span>
            </div>
            {order?.digital_download_url ? (
              <>
                <p className="text-sm text-blue-700 mb-3">Tu archivo está listo. También te lo enviamos por correo.</p>
                <a href={order.digital_download_url}
                  className="flex items-center justify-center gap-2 w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold text-sm no-underline hover:bg-blue-700 transition-colors">
                  📥 Descargar ahora
                </a>
                {order.digital_download_expires_at && (
                  <p className="text-xs text-blue-500 mt-2 text-center">
                    Enlace válido hasta {new Date(order.digital_download_expires_at as string).toLocaleString('es-MX')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-blue-700">
                Tu descarga se está preparando — te llegará por correo en los próximos minutos.
              </p>
            )}
          </div>
        )}

        {listingType !== 'digital' && (
          <div className="border border-[var(--color-border)] rounded-xl p-4 mb-6 text-sm text-left">
            <p className="text-[var(--color-muted)]">
              El vendedor recibirá una notificación y se pondrá en contacto contigo para coordinar la entrega.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {listingId && (
            <Link href={`/l/${listingId}`}
              className="border border-[var(--color-border)] px-5 py-2.5 rounded-lg text-sm font-medium no-underline hover:bg-[var(--color-surface-alt)] transition-colors">
              Ver el anuncio
            </Link>
          )}
          <Link href="/l"
            className="text-sm text-[var(--color-muted)] no-underline hover:text-[var(--color-foreground)]">
            Seguir explorando →
          </Link>
        </div>

        <p className="text-xs text-[var(--color-muted)] mt-8">
          ✓ Pago seguro con Stripe · ✓ Sin comisiones de plataforma
        </p>
      </div>
    </div>
  )
}

// ── Shared UI for new Medusa flow ─────────────────────────────────────────────

function CheckIcon() {
  return (
    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  )
}

function SuccessUI({
  buyerName,
  amountPaid,
  itemName,
  orderNumber,
  sellerName,
  listingId,
  isDigital: _isDigital,
  provider,
}: {
  buyerName: string | null
  amountPaid: string | null
  itemName: string
  orderNumber: string | null
  sellerName: string | null
  listingId: string | null
  isDigital: boolean
  provider: 'stripe' | 'mercadopago'
}) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <CheckIcon />
        <h1 className="text-2xl font-bold mb-1">
          {buyerName ? `¡Gracias, ${buyerName}!` : '¡Pago completado!'}
        </h1>
        {orderNumber && (
          <p className="text-sm text-[var(--color-muted)] mb-6">Pedido {orderNumber}</p>
        )}

        {/* Order summary */}
        <div className="border border-[var(--color-border)] rounded-xl p-4 mb-4 text-sm text-left">
          <div className="flex justify-between gap-3 py-1">
            <span className="text-[var(--color-muted)]">Artículo</span>
            <span className="font-medium text-right">{itemName}</span>
          </div>
          {sellerName && (
            <div className="flex justify-between gap-3 py-1">
              <span className="text-[var(--color-muted)]">Vendedor</span>
              <span className="font-medium text-right">{sellerName}</span>
            </div>
          )}
          {amountPaid && (
            <div className="flex justify-between gap-3 py-1 mt-1 pt-2 border-t border-[var(--color-border)]">
              <span className="text-[var(--color-muted)]">Pagado</span>
              <span className="font-bold text-right">{amountPaid}</span>
            </div>
          )}
        </div>

        <div className="border border-[var(--color-border)] rounded-xl p-4 mb-6 text-sm text-left">
          <p className="text-[var(--color-muted)]">
            El vendedor recibirá una notificación y se pondrá en contacto contigo para coordinar la entrega.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/account/orders"
            className="bg-[var(--color-foreground)] text-[var(--color-background)] px-5 py-2.5 rounded-lg text-sm font-semibold no-underline hover:opacity-90 transition-opacity">
            Ver mis pedidos
          </Link>
          {listingId && (
            <Link href={`/l/${listingId}`}
              className="border border-[var(--color-border)] px-5 py-2.5 rounded-lg text-sm font-medium no-underline hover:bg-[var(--color-surface-alt)] transition-colors">
              Ver el anuncio
            </Link>
          )}
          <Link href="/l"
            className="text-sm text-[var(--color-muted)] no-underline hover:text-[var(--color-foreground)]">
            Seguir explorando →
          </Link>
        </div>

        <p className="text-xs text-[var(--color-muted)] mt-8">
          {provider === 'mercadopago'
            ? '✓ Pago seguro con Mercado Pago · ✓ Sin comisiones de plataforma'
            : '✓ Pago seguro con Stripe · ✓ Sin comisiones de plataforma'}
        </p>
      </div>
    </div>
  )
}
