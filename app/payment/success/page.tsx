import { redirect } from 'next/navigation'
import Link from 'next/link'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'

export const metadata = { title: 'Pago completado — Miyagi Sánchez' }

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id } = await searchParams
  if (!session_id) redirect('/')

  // Retrieve session to show order details
  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>> | null = null
  try {
    session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items'],
    })
  } catch {
    redirect('/')
  }

  const listingId = session.metadata?.listing_id
  const listingType = session.metadata?.listing_type

  // Fetch order for digital download URL
  const { data: order } = listingId ? await db
    .from('marketplace_orders')
    .select('id, status, digital_download_url, digital_download_expires_at')
    .eq('stripe_session_id', session_id)
    .maybeSingle() : { data: null }

  const buyerName = session.customer_details?.name?.split(' ')[0] ?? null
  const amountPaid = session.amount_total
    ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: session.currency?.toUpperCase() ?? 'MXN', maximumFractionDigits: 0 }).format(session.amount_total / 100)
    : null

  const itemName = session.line_items?.data?.[0]?.description ?? session.line_items?.data?.[0]?.price?.nickname ?? 'tu compra'

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">

        {/* Success icon */}
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-2">
          {buyerName ? `¡Gracias, ${buyerName}!` : '¡Pago completado!'}
        </h1>
        {amountPaid && (
          <p className="text-[var(--color-muted)] mb-6">
            Pagaste <strong className="text-[var(--color-foreground)]">{amountPaid}</strong> por {itemName}.
          </p>
        )}

        {/* Digital delivery */}
        {listingType === 'digital' && (
          <div className="border border-blue-200 bg-blue-50 rounded-xl p-5 mb-6 text-left">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📥</span>
              <span className="font-semibold text-blue-800">Entrega digital</span>
            </div>
            {order?.digital_download_url ? (
              <>
                <p className="text-sm text-blue-700 mb-3">
                  Tu archivo está listo. También te lo enviamos por correo.
                </p>
                <a
                  href={order.digital_download_url}
                  className="flex items-center justify-center gap-2 w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold text-sm no-underline hover:bg-blue-700 transition-colors"
                >
                  📥 Descargar ahora
                </a>
                {order.digital_download_expires_at && (
                  <p className="text-xs text-blue-500 mt-2 text-center">
                    Enlace válido hasta {new Date(order.digital_download_expires_at).toLocaleString('es-MX')}
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

        {/* Physical / service */}
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
