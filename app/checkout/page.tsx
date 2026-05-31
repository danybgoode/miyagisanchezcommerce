import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { getListing, formatPrice } from '@/lib/listings'
import { getShopStripe } from '@/lib/stripe'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'
import { db } from '@/lib/supabase'
import CheckoutExperience from './CheckoutExperience'
import type { CheckoutProvider } from '@/lib/cart'
import type { DeliveryOption, ManualOption } from './CheckoutExperience'

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
  local_pickup?: boolean
  envia_enabled?: boolean
  pickup_spots?: Array<{ name?: string; address?: string; instructions?: string }>
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

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null
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
  const sellerHasMp = sellerHasMpConnected(shopMeta)
  const offerPriceCents = await getAcceptedOfferPrice(params.offerId, listing.id, user.id)
  if (params.offerId && !offerPriceCents) redirect(`/l/${listing.id}?offer=unavailable`)
  const amountCents = offerPriceCents ?? listing.price_cents
  if (!amountCents || amountCents <= 0) redirect(`/l/${listing.id}`)
  if (listing.status !== 'active') redirect(`/l/${listing.id}?checkout=unavailable`)
  // Block checkout for sold-out (Medusa-managed) items — backend reserves stock on
  // order placement, so this saves the buyer a failed add-to-cart at the rail.
  if (listing.in_stock === false) redirect(`/l/${listing.id}?checkout=unavailable`)

  // Card providers — computed later after delivery options are known.
  // Defined here to satisfy hoisting; overwritten below.
  let availableProviders: CheckoutProvider[] = [
    sellerHasMp && listing.listing_type !== 'digital' ? 'mercadopago' as const : null,
    sellerHasStripe ? 'stripe' as const : null,
  ].filter(Boolean) as CheckoutProvider[]

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
  const originAddress = (shippingSettings as ShippingSettings & { origin_address?: Record<string, string | null> }).origin_address
  const hasShippingOrigin = !!(originAddress?.street && originAddress?.city && originAddress?.state && originAddress?.postal_code)
  const hasLiveShipping = shippingSettings.envia_enabled !== false && hasShippingOrigin
  const deliveryOptions = ([
    shippingSettings.local_pickup
      ? { id: 'local_pickup' as const, label: 'Recolección en mano', note: pickupSpots[0]?.name ?? 'El vendedor confirmará el horario y punto de entrega.', detail: pickupSpots[0]?.address ?? pickupSpots[0]?.instructions ?? null, pickupSpotId: pickupSpots[0]?.name }
      : null,
    !isDigital && listing.listing_type === 'product' && hasLiveShipping
      ? { id: 'shipping' as const, label: 'Envio a domicilio', note: 'Cotiza y elige paqueteria antes de pagar.', requiresAddress: true }
      : null,
    isDigital
      ? { id: 'digital' as const, label: 'Entrega digital', note: 'Recibiras acceso o archivo despues del pago.' }
      : null,
    listing.listing_type === 'service'
      ? { id: 'service' as const, label: 'Servicio', note: bookingUrl ? 'Agenda disponible despues de pagar.' : 'Coordina horario con el vendedor.' }
      : null,
    listing.listing_type === 'rental'
      ? { id: 'rental' as const, label: 'Renta', note: bookingUrl ? 'Revisa disponibilidad con el vendedor.' : 'Coordina fechas con el vendedor.' }
      : null,
    !shippingSettings.local_pickup && !isDigital && listing.listing_type === 'product' && !hasLiveShipping
      ? { id: 'none' as const, label: 'Entrega acordada', note: 'El vendedor te contactará para acordar cómo y cuándo recibirás tu pedido.' }
      : null,
  ] as Array<DeliveryOption | null>).filter(isPresent)

  // "Entrega acordada" is the only delivery option — no card payments.
  // Physical products with no structured delivery require coordination from
  // both ends; instant card payment creates buyer anxiety with no delivery path.
  const onlyCoordinated = deliveryOptions.length === 1 && deliveryOptions[0]?.id === 'none'
  if (onlyCoordinated) availableProviders = []

  const paymentOptions = availableProviders.map(provider => ({
    id: provider,
    label: provider === 'mercadopago' ? 'Mercado Pago' : 'Tarjeta',
    note: provider === 'mercadopago'
      ? 'Tarjeta, wallet, OXXO y meses sin intereses.'
      : 'Checkout seguro de Stripe.',
  }))

  const manualOptions = ([
    hasBankTransfer
      ? { id: 'spei', label: 'SPEI', note: bankTransfer?.bank_name ?? 'Transferencia bancaria.', detail: `CLABE ${bankTransfer?.clabe}${bankTransfer?.account_holder ? ` - ${bankTransfer.account_holder}` : ''}` }
      : null,
    shippingSettings.local_pickup && !isDigital
      ? { id: 'cash_on_pickup', label: 'Efectivo al recoger', note: 'Disponible para recoleccion local.', detail: visiblePhone ? `Tel. ${visiblePhone}` : null }
      : null,
    directWhatsappUrl
      ? { id: 'whatsapp', label: 'Acordar por WhatsApp', note: 'Coordina pago y entrega directamente.', href: directWhatsappUrl }
      : null,
    bookingUrl
      ? { id: 'schedule', label: 'Agenda', note: bookingText ?? 'Reservar horario.', href: bookingUrl }
      : null,
    preparation ? { id: 'processing', label: 'Preparacion', note: preparation } : null,
  ] as Array<ManualOption | null>).filter(isPresent)

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

        <CheckoutExperience
          listingId={listing.id}
          sellerId={listing.shop!.id}
          amountCents={amountCents}
          currency={listing.currency}
          deliveryOptions={deliveryOptions}
          paymentOptions={paymentOptions}
          manualOptions={manualOptions}
          offerId={params.offerId}
          offerAmountCents={offerPriceCents ?? undefined}
          onlyCoordinated={onlyCoordinated}
        />
      </div>
    </main>
  )
}
