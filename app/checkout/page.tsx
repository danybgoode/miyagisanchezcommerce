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

type CheckoutSettings = {
  show_phone?: boolean
  phone?: string | null
  whatsapp_cta?: boolean
  show_email?: boolean
  contact_email?: string | null
  bank_transfer?: {
    enabled?: boolean
    clabe?: string | null
    bank_name?: string | null
    account_holder?: string | null
  }
}

type ShippingSettings = {
  mercado_envios?: boolean
  local_pickup?: boolean
  pickup_spots?: Array<{ name?: string; address?: string; instructions?: string }>
}

type CheckoutInfoItem = {
  icon: string
  label: string
  note: string
  detail?: string | null
  href?: string | null
}

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function whatsappLink(phone: string, title: string) {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const mxPhone = digits.startsWith('52') ? digits : `52${digits}`
  const text = encodeURIComponent(`Hola, quiero coordinar la compra de "${title}" en Miyagi Sanchez.`)
  return `https://wa.me/${mxPhone}?text=${text}`
}

function processingLabel(value: unknown) {
  const labels: Record<string, string> = {
    '1d': '1 dia habil',
    '1-3d': '1 a 3 dias habiles',
    '3-5d': '3 a 5 dias habiles',
    '1-2w': '1 a 2 semanas',
  }
  return typeof value === 'string' ? labels[value] ?? value : null
}

async function resolvePublicListingId(listingId: string) {
  if (listingId.startsWith('prod_')) return listingId

  const { data } = await db
    .from('marketplace_listings')
    .select('medusa_product_id')
    .eq('id', listingId)
    .maybeSingle()

  return data?.medusa_product_id ?? listingId
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
  const mirror = offer.marketplace_listings as unknown as { id?: string | null; medusa_product_id?: string | null } | { id?: string | null; medusa_product_id?: string | null }[]
  const mirrorListing = Array.isArray(mirror) ? mirror[0] : mirror
  const medusaProductId = mirrorListing?.medusa_product_id
  const mirrorId = mirrorListing?.id
  if (medusaProductId !== listingId && mirrorId !== listingId) return null
  if (offer.checkout_expires_at && new Date(offer.checkout_expires_at).getTime() < Date.now()) return null

  return offer.counter_amount_cents ?? offer.offer_amount_cents
}

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const rawListingId = params.listingId
  if (!rawListingId) redirect('/l')
  const listingId = await resolvePublicListingId(rawListingId)

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
  if (params.offerId && !offerPriceCents) redirect(`/l/${listing.id}?offer=unavailable`)
  const amountCents = offerPriceCents ?? listing.price_cents
  if (!amountCents || amountCents <= 0) redirect(`/l/${listing.id}`)
  if (listing.status !== 'active') redirect(`/l/${listing.id}?checkout=unavailable`)

  const availableProviders: CheckoutProvider[] = [
    sellerHasMp && listing.listing_type !== 'digital' ? 'mercadopago' as const : null,
    sellerHasStripe ? 'stripe' as const : null,
  ].filter(Boolean) as CheckoutProvider[]
  const selectedProvider = params.provider && availableProviders.includes(params.provider)
    ? params.provider
    : availableProviders[0]

  const image = listing.images?.[0]?.url ?? null
  const isOfferCheckout = !!offerPriceCents
  const shopSettings = (shopMeta?.settings ?? {}) as Record<string, unknown>
  const checkoutSettings = (shopSettings.checkout ?? {}) as CheckoutSettings
  const shippingSettings = (shopSettings.shipping ?? {}) as ShippingSettings
  const ordersSettings = (shopSettings.orders ?? {}) as { processing_time?: string }
  const themeSettings = (shopSettings.theme ?? {}) as { social?: { whatsapp?: string | null } }
  const schedulingSettings = (shopSettings.scheduling ?? {}) as { links?: Array<{ label?: string; url?: string }> }
  const calcomSettings = (shopSettings.calcom ?? {}) as { connected?: boolean; booking_url?: string; event_type_title?: string }
  const isDigital = listing.listing_type === 'digital'
  const pickupSpots = shippingSettings.local_pickup ? (shippingSettings.pickup_spots ?? []) : []
  const bankTransfer = checkoutSettings.bank_transfer
  const hasBankTransfer = !!(bankTransfer?.enabled && bankTransfer.clabe?.trim())
  const visiblePhone = checkoutSettings.show_phone && checkoutSettings.phone ? checkoutSettings.phone : null
  const whatsappPhone = checkoutSettings.whatsapp_cta
    ? (themeSettings.social?.whatsapp || checkoutSettings.phone || null)
    : null
  const schedulingLinks = (schedulingSettings.links ?? []).filter((link): link is { label?: string; url: string } => !!link.url)
  const bookingUrl = calcomSettings.connected && calcomSettings.booking_url
    ? calcomSettings.booking_url
    : schedulingLinks[0]?.url ?? null
  const bookingText = calcomSettings.event_type_title ?? schedulingLinks[0]?.label ?? null
  const preparation = processingLabel(ordersSettings.processing_time)
  const directWhatsappUrl = whatsappPhone ? whatsappLink(whatsappPhone, listing.title) : null

  const fulfillmentOptions: CheckoutInfoItem[] = [
    shippingSettings.mercado_envios && listing.listing_type === 'product'
      ? { icon: 'iconoir-delivery-truck', label: 'Mercado Envios', note: 'El vendedor marco envio disponible.', detail: 'El costo y datos finales se coordinan al completar la compra.' }
      : null,
    shippingSettings.local_pickup
      ? { icon: 'iconoir-shop', label: 'Recoleccion local', note: pickupSpots[0]?.name ?? 'Coordina lugar y hora con el vendedor.', detail: pickupSpots[0]?.address ?? pickupSpots[0]?.instructions ?? null }
      : null,
    isDigital
      ? { icon: 'iconoir-download', label: 'Entrega digital', note: 'Recibiras acceso o archivo despues del pago.' }
      : null,
    listing.listing_type === 'service'
      ? { icon: 'iconoir-calendar', label: 'Servicio', note: bookingUrl ? 'Agenda disponible.' : 'Coordina horario con el vendedor.', href: bookingUrl }
      : null,
    listing.listing_type === 'rental'
      ? { icon: 'iconoir-calendar', label: 'Renta', note: bookingUrl ? 'Revisa disponibilidad con el vendedor.' : 'Coordina fechas con el vendedor.', href: bookingUrl }
      : null,
    preparation ? { icon: 'iconoir-box', label: 'Preparacion', note: preparation } : null,
  ].filter(Boolean) as CheckoutInfoItem[]

  const configuredPaymentOptions: CheckoutInfoItem[] = [
    sellerHasMp && !isDigital
      ? { icon: 'iconoir-credit-card', label: 'Mercado Pago', note: 'Tarjeta, wallet, OXXO y meses sin intereses.' }
      : null,
    sellerHasStripe
      ? { icon: 'iconoir-credit-card', label: 'Tarjeta internacional', note: 'Visa, Mastercard y American Express.' }
      : null,
    hasBankTransfer
      ? { icon: 'iconoir-bank', label: 'SPEI', note: bankTransfer?.bank_name ?? 'Transferencia bancaria.', detail: `CLABE ${bankTransfer?.clabe}${bankTransfer?.account_holder ? ` - ${bankTransfer.account_holder}` : ''}` }
      : null,
    shippingSettings.local_pickup && !isDigital
      ? { icon: 'iconoir-cash', label: 'Efectivo al recoger', note: 'Disponible para recoleccion local.', detail: visiblePhone ? `Tel. ${visiblePhone}` : null }
      : null,
    directWhatsappUrl
      ? { icon: 'iconoir-chat-bubble', label: 'Acordar por WhatsApp', note: 'Coordina pago y entrega directamente.', href: directWhatsappUrl }
      : null,
    bookingUrl
      ? { icon: 'iconoir-calendar', label: 'Agenda', note: bookingText ?? 'Reservar horario.', href: bookingUrl }
      : null,
  ].filter(Boolean) as CheckoutInfoItem[]

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
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Entrega configurada</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {fulfillmentOptions.length > 0 ? fulfillmentOptions.map(option => (
              <div key={option.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, background: 'var(--bg-sunk)', borderRadius: 8 }}>
                <i className={option.icon} style={{ fontSize: 18, color: 'var(--accent)', marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{option.label}</p>
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{option.note}</p>
                  {option.detail && <p style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2 }}>{option.detail}</p>}
                  {option.href && (
                    <a href={option.href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>
                      Abrir enlace
                    </a>
                  )}
                </div>
              </div>
            )) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, background: 'var(--bg-sunk)', borderRadius: 8 }}>
                <i className="iconoir-delivery-truck" style={{ fontSize: 18, color: 'var(--accent)', marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>Entrega por coordinar</p>
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>El vendedor no ha publicado opciones de entrega especificas. Coordina los detalles desde tu pedido.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Métodos del vendedor</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {configuredPaymentOptions.length > 0 ? configuredPaymentOptions.map(option => (
              <div key={option.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, background: 'var(--bg-sunk)', borderRadius: 8 }}>
                <i className={option.icon} style={{ fontSize: 18, color: 'var(--accent)', marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>{option.label}</p>
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{option.note}</p>
                  {option.detail && <p style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 2, overflowWrap: 'anywhere' }}>{option.detail}</p>}
                  {option.href && (
                    <a href={option.href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>
                      Abrir enlace
                    </a>
                  )}
                </div>
              </div>
            )) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, background: 'var(--bg-sunk)', borderRadius: 8 }}>
                <i className="iconoir-credit-card" style={{ fontSize: 18, color: 'var(--accent)', marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>Sin métodos publicados</p>
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>Escríbele al vendedor para coordinar pago y entrega.</p>
                </div>
              </div>
            )}
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
