/**
 * /payment/success
 *
 * Handles two flows:
 *   - New Medusa flow:  ?cart_id=cart_xxx  (from start-checkout success_url)
 *     Also supports MP extra params: &payment_id=xxx&status=approved
 *   - Legacy Stripe flow: ?session_id=cs_xxx (backwards compat)
 */

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'
import { isVerifiedCustomDomain } from '@/lib/custom-domain'

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

function formatCents(cents: unknown, currency: unknown): string | null {
  const amount = Math.round(Number(cents ?? 0))
  if (!Number.isFinite(amount) || amount <= 0) return null
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: String(currency ?? 'MXN').toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount / 100)
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

    // Async-success recovery (S3.3): completion can still be settling (webhook race)
    // or have failed. Never show a false "success" with a null order — render a
    // recovery state with a retry (re-runs this idempotent completion) instead.
    if (!order) {
      return <PaymentPendingRecovery cartId={cartId} mpPaymentId={mpPaymentId} mpStatus={mpStatus} />
    }

    // Own-channel return: if this purchase began on a tenant's custom domain, send
    // the buyer back to that domain's success page so the funnel ends on their brand.
    // Guards: redirect ONLY to a VERIFIED tenant domain (never a value forged into
    // order metadata → no open redirect), and ONLY from the platform — the onChannel
    // check stops a redirect loop once we're already on the domain. completeMedusaCart
    // is idempotent, so re-running it on the domain just returns the same order.
    const orderMeta = (order?.metadata ?? {}) as Record<string, unknown>
    const originDomain = typeof orderMeta.origin_domain === 'string' ? orderMeta.origin_domain : null
    if (originDomain && orderMeta.channel === 'custom_domain') {
      const onChannel = (await headers()).get('x-miyagi-channel') === 'custom'
      if (!onChannel && (await isVerifiedCustomDomain(originDomain))) {
        const qs = new URLSearchParams({ cart_id: cartId })
        if (mpPaymentId) qs.set('payment_id', mpPaymentId)
        if (mpStatus) qs.set('status', mpStatus)
        redirect(`https://${originDomain}/payment/success?${qs.toString()}`)
      }
    }

    const supportMeta = (orderMeta.support ?? null) as Record<string, unknown> | null
    if (supportMeta?.kind === 'support') {
      return <SupportSuccessUI
        cartId={cartId}
        orderId={(order?.id as string | undefined) ?? null}
        amountPaid={formatCents(supportMeta.amount_cents, supportMeta.currency)}
        amountCents={Math.round(Number(supportMeta.amount_cents ?? 0))}
        currency={String(supportMeta.currency ?? 'MXN').toUpperCase()}
        sellerSlug={(supportMeta.seller_slug as string | undefined) ?? null}
        provider={mpPaymentId ? 'mercadopago' : 'stripe'}
      />
    }

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

    // ── Print-ad placement? Route to the print management surface ──────────
    // (a placement is not a shippable order; it lives in /account/print-ads)
    const { data: printSub } = await db
      .from('print_ad_submissions').select('id').eq('cart_id', cartId).maybeSingle()
    if (printSub) return <PrintSuccessUI amountPaid={amountPaid} />

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

function SupportSuccessBridge({
  cartId,
  orderId,
  amountCents,
  currency,
}: {
  cartId: string
  orderId: string | null
  amountCents: number
  currency: string
}) {
  const payload = JSON.stringify({
    type: 'miyagi:support:success',
    cart_id: cartId,
    order_id: orderId,
    amount_cents: amountCents,
    currency,
  }).replace(/</g, '\\u003c')

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function () {
            var payload = ${payload};
            try {
              if (window.opener && !window.opener.closed) window.opener.postMessage(payload, '*');
              if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*');
            } catch (e) {}
          })();
        `,
      }}
    />
  )
}

function SupportSuccessUI({
  cartId,
  orderId,
  amountPaid,
  amountCents,
  currency,
  sellerSlug,
  provider,
}: {
  cartId: string
  orderId: string | null
  amountPaid: string | null
  amountCents: number
  currency: string
  sellerSlug: string | null
  provider: 'stripe' | 'mercadopago'
}) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <SupportSuccessBridge cartId={cartId} orderId={orderId} amountCents={amountCents} currency={currency} />
      <div className="max-w-md w-full text-center">
        <CheckIcon />
        <h1 className="text-2xl font-bold mb-2">Gracias por apoyar</h1>
        <p className="text-[var(--color-muted)] mb-6">
          {amountPaid ? <>Tu contribución de <strong className="text-[var(--color-foreground)]">{amountPaid}</strong> fue recibida.</> : 'Tu contribución fue recibida.'}
        </p>

        <div className="border border-[var(--color-border)] rounded-xl p-4 mb-6 text-sm text-left">
          <div className="flex justify-between gap-3 py-1">
            <span className="text-[var(--color-muted)]">Concepto</span>
            <span className="font-medium text-right">Apoyo / contribución</span>
          </div>
          {amountPaid && (
            <div className="flex justify-between gap-3 py-1 mt-1 pt-2 border-t border-[var(--color-border)]">
              <span className="text-[var(--color-muted)]">Pagado</span>
              <span className="font-bold text-right">{amountPaid}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {sellerSlug && (
            <Link href={`/s/${sellerSlug}`}
              className="border border-[var(--color-border)] px-5 py-2.5 rounded-lg text-sm font-medium no-underline hover:bg-[var(--color-surface-alt)] transition-colors">
              Ver la tienda
            </Link>
          )}
          <Link href="/"
            className="text-sm text-[var(--color-muted)] no-underline hover:text-[var(--color-foreground)]">
            Volver a Miyagi Sánchez
          </Link>
        </div>

        <p className="text-xs text-[var(--color-muted)] mt-8">
          {provider === 'mercadopago' ? 'Pago seguro con Mercado Pago' : 'Pago seguro con Stripe'}
        </p>
      </div>
    </div>
  )
}

// ── Print-ad placement success — routes to /account/print-ads ────────────────

function PrintSuccessUI({ amountPaid }: { amountPaid: string | null }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4">🗞️</div>
        <h1 className="text-2xl font-bold mb-2">¡Recibimos tu anuncio!</h1>
        <p className="text-[var(--color-muted)] mb-6">
          {amountPaid ? <>Pagaste <strong className="text-[var(--color-foreground)]">{amountPaid}</strong>. </> : null}
          Nuestro equipo diseñará tu anuncio con estética México 86 y lo incluirá en la edición impresa. Te avisamos por correo cuando esté listo.
        </p>
        <Link
          href="/account/print-ads"
          className="inline-block bg-[var(--color-accent)] text-white px-6 py-3 rounded-lg font-semibold no-underline hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Ver mis anuncios
        </Link>
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

// S3.3 — shown when cart completion hasn't produced an order yet (webhook race or
// a failed/settling payment). A recovery state, never a false success. "Revisar de
// nuevo" re-navigates to this same URL, re-running the idempotent completion;
// prefetch is disabled so a hover can't silently re-run it.
function PaymentPendingRecovery({
  cartId,
  mpPaymentId,
  mpStatus,
}: {
  cartId: string
  mpPaymentId?: string
  mpStatus?: string
}) {
  const qs = new URLSearchParams({ cart_id: cartId })
  if (mpPaymentId) qs.set('payment_id', mpPaymentId)
  if (mpStatus) qs.set('status', mpStatus)
  const retryHref = `/payment/success?${qs.toString()}`
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl" aria-hidden>⏳</span>
        </div>
        <h1 className="text-2xl font-bold mb-1">Estamos confirmando tu pedido</h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">
          Tu pago se está procesando. Esto puede tardar unos segundos. <strong>No vuelvas a pagar</strong> —
          en cuanto se confirme aparecerá tu pedido.
        </p>
        <div className="flex flex-col gap-2">
          <Link href={retryHref} prefetch={false}
            className="w-full bg-[var(--color-accent)] text-white py-3 rounded-xl text-sm font-semibold no-underline">
            Revisar de nuevo
          </Link>
          <Link href="/account/orders"
            className="w-full border border-[var(--color-border)] py-3 rounded-xl text-sm font-semibold no-underline text-[var(--color-text)]">
            Ver mis pedidos
          </Link>
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-4">
          Si después de unos minutos no aparece, escríbenos y lo resolvemos.
        </p>
      </div>
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
