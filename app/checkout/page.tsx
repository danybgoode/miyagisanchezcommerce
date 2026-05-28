import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { getListing, formatPrice } from '@/lib/listings'
import { getShopStripe } from '@/lib/stripe'
import { db } from '@/lib/supabase'
import CheckoutPayButton from '@/app/components/CheckoutPayButton'
import type { CheckoutProvider } from '@/lib/cart'

type SearchParams = {
  listingId?: string
  offerId?: string
  provider?: CheckoutProvider
}

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

async function getAcceptedOfferPrice(offerId: string | undefined, listingId: string, buyerUserId: string) {
  if (!offerId) return null

  const { data: offer } = await db
    .from('marketplace_offers')
    .select(`
      id, status, offer_amount_cents, counter_amount_cents, checkout_expires_at,
      marketplace_listings!inner(id, medusa_product_id)
    `)
    .eq('id', offerId)
    .eq('buyer_clerk_user_id', buyerUserId)
    .maybeSingle()

  if (!offer || offer.status !== 'accepted') return null
  const mirror = offer.marketplace_listings as unknown as { medusa_product_id?: string | null } | { medusa_product_id?: string | null }[]
  const medusaProductId = Array.isArray(mirror) ? mirror[0]?.medusa_product_id : mirror?.medusa_product_id
  if (medusaProductId !== listingId) return null
  if (offer.checkout_expires_at && new Date(offer.checkout_expires_at).getTime() < Date.now()) return null

  return offer.counter_amount_cents ?? offer.offer_amount_cents
}

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const listingId = params.listingId
  if (!listingId) redirect('/l')

  const user = await currentUser()
  if (!user) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/checkout?listingId=${listingId}${params.offerId ? `&offerId=${params.offerId}` : ''}${params.provider ? `&provider=${params.provider}` : ''}`)}`)

  const listing = await getListing(listingId)
  if (!listing) notFound()

  const isClaimed = !!(listing.shop?.id && !listing.shop.clerk_user_id?.startsWith('pending:'))
  if (!isClaimed || listing.shop?.clerk_user_id === user.id) redirect(`/l/${listing.id}`)

  const shopMeta = listing.shop?.metadata as Record<string, unknown> | null
  const stripeSettings = getShopStripe(shopMeta)
  const sellerHasStripe = !!(stripeSettings.charges_enabled && stripeSettings.account_id && stripeSettings.enabled !== false)
  const sellerHasMp = (shopMeta?.mp_enabled as boolean | undefined) !== false
  const offerPriceCents = await getAcceptedOfferPrice(params.offerId, listing.id, user.id)
  const amountCents = offerPriceCents ?? listing.price_cents
  if (!amountCents || amountCents <= 0) redirect(`/l/${listing.id}`)

  const availableProviders: CheckoutProvider[] = [
    sellerHasMp && listing.listing_type !== 'digital' ? 'mercadopago' as const : null,
    sellerHasStripe ? 'stripe' as const : null,
  ].filter(Boolean) as CheckoutProvider[]
  const selectedProvider = params.provider && availableProviders.includes(params.provider)
    ? params.provider
    : availableProviders[0]

  const image = listing.images?.[0]?.url ?? null
  const isOfferCheckout = !!offerPriceCents

  return (
    <main className="max-w-[760px] mx-auto px-4 py-5 md:py-8">
      <div style={{ marginBottom: 18 }}>
        <Link href={`/l/${listing.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>
          <i className="iconoir-arrow-left" style={{ fontSize: 16 }} />
          Volver al anuncio
        </Link>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>Revisar compra</h1>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>Confirma el precio, entrega y método de pago antes de continuar.</p>
          </div>
          <div style={{ padding: 16, display: 'flex', gap: 12 }}>
            <div style={{ width: 88, height: 88, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-sunk)', flexShrink: 0 }}>
              {image ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{listing.title}</p>
              <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>{listing.shop?.name}</p>
              {isOfferCheckout ? (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>Precio acordado</p>
                  <p style={{ fontSize: 22, fontWeight: 800 }}>{formatCents(amountCents, listing.currency)}</p>
                  {listing.price_cents && <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Original: <span style={{ textDecoration: 'line-through' }}>{formatPrice(listing)}</span></p>}
                </div>
              ) : (
                <p style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>{formatCents(amountCents, listing.currency)}</p>
              )}
            </div>
          </div>
        </section>

        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Entrega</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, background: 'var(--bg-sunk)', borderRadius: 8 }}>
              <i className={listing.listing_type === 'digital' ? 'iconoir-download' : 'iconoir-delivery-truck'} style={{ fontSize: 18, color: 'var(--accent)', marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 700 }}>{listing.listing_type === 'digital' ? 'Entrega digital' : 'Envío o recolección'}</p>
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                  {listing.listing_type === 'digital'
                    ? 'Recibirás el archivo al completar el pago.'
                    : 'Los detalles finales de entrega se coordinan después del pago desde tu pedido.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Resumen</h2>
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Artículo</span>
              <strong>{formatCents(amountCents, listing.currency)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--fg-muted)' }}>Comisión Miyagi</span>
              <strong>$0</strong>
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800 }}>
              <span>Total</span>
              <span>{formatCents(amountCents, listing.currency)}</span>
            </div>
          </div>

          {availableProviders.length > 0 ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {availableProviders.map(provider => (
                <CheckoutPayButton
                  key={provider}
                  provider={provider}
                  listingId={listing.id}
                  amountCents={amountCents}
                  currency={listing.currency}
                  offerId={params.offerId}
                  offerAmountCents={offerPriceCents ?? undefined}
                />
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Este vendedor todavía no tiene pagos en línea activos.</p>
          )}

          {selectedProvider && availableProviders.length > 1 && (
            <p style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 8 }}>Método recomendado: {selectedProvider === 'mercadopago' ? 'Mercado Pago' : 'tarjeta'}.</p>
          )}
        </section>
      </div>
    </main>
  )
}
