import { notFound, permanentRedirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { getListing, getShopListings, formatPrice, conditionLabel } from '@/lib/listings'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import { getShopStripe } from '@/lib/stripe'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'
import BuyButton from '@/app/components/BuyButton'
import MakeOfferButton from '@/app/components/MakeOfferButton'
import FavoriteButton from '@/app/components/FavoriteButton'
import AskSellerButton from '@/app/components/AskSellerButton'
import OfferCheckoutButton from '@/app/components/OfferCheckoutButton'
import SellerBundleSection from '@/app/components/SellerBundleSection'
import SubscriptionSection from './SubscriptionSection'
import { db } from '@/lib/supabase'
import { getActiveDealForBuyer } from '@/lib/active-deal'
import { formatOfferAmount } from '@/lib/offers'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) return { title: 'Anuncio no encontrado' }
  // Canonical follows the seller's live custom domain when set, so the product
  // ranks under the brand domain rather than the marketplace mirror.
  const domain = await getActiveCustomDomain(listing.shop?.slug ?? '')
  const canonical = domain ? `https://${domain}/l/${listing.id}` : `https://miyagisanchez.com/l/${listing.id}`
  return {
    title: listing.title,
    description: listing.description ?? undefined,
    alternates: { canonical },
    openGraph: { url: canonical },
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Hace ${hrs} h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `Hace ${days} día${days > 1 ? 's' : ''}`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  if (months < 12) return `Hace ${months} mes${months > 1 ? 'es' : ''}`
  return `Hace ${Math.floor(months / 12)} año${Math.floor(months / 12) > 1 ? 's' : ''}`
}

function whatsappUrl(raw: string, title: string): string {
  const digits = raw.replace(/\D/g, '')
  const full = digits.startsWith('52') ? digits : `52${digits}`
  const text = encodeURIComponent(`Hola, vi tu anuncio "${title}" en miyagisanchez.com y me interesa. ¿Sigue disponible?`)
  return `https://wa.me/${full}?text=${text}`
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [listing, clerkUser] = await Promise.all([getListing(id), currentUser()])
  if (!listing) notFound()

  // Custom-domain boundary: a tenant store shows ONLY its own products. If this
  // PDP is reached on a custom domain (channel slug set by middleware) but the
  // product belongs to another shop, render the white-label not-found instead of
  // leaking a different seller's listing under this brand.
  const channelSlug = (await headers()).get('x-miyagi-shop-slug')
  const onChannel = !!channelSlug
  if (onChannel && listing.shop?.slug !== channelSlug) notFound()

  // SEO continuity: on the marketplace host, if this product's shop has a LIVE
  // custom domain, 308-redirect the legacy /l/[id] link to the tenant's own
  // domain so traffic + ranking consolidate there.
  if (!onChannel) {
    const domain = await getActiveCustomDomain(listing.shop?.slug ?? '')
    if (domain) permanentRedirect(`https://${domain}/l/${listing.id}`)
  }

  const isSignedIn = !!clerkUser
  const isOwnListing = !!clerkUser && listing.shop?.clerk_user_id === clerkUser.id
  // Medusa-backed sellers always have an id; legacy "pending:" shops are unclaimed scraped entries
  const isClaimed = !!(listing.shop?.id && !listing.shop.clerk_user_id?.startsWith('pending:'))
  const digitalFile = listing.metadata?.digital_file as { name?: string; size?: number; label?: string } | undefined
  const isDigital = listing.listing_type === 'digital'
  // Print-ad placements are bought through the ad builder (which captures the ad
  // ingredients), never via the generic PDP checkout. Funnel to /sell/print/[edition].
  const isPrintPlacement = listing.metadata?.is_print_placement === true
  const printEditionId = listing.metadata?.print_edition_id as string | undefined
  const shopMeta = listing.shop?.metadata as Record<string, unknown> | null
  const stripeSettings = getShopStripe(shopMeta)
  const sellerHasStripe = !!(stripeSettings.charges_enabled && stripeSettings.account_id && stripeSettings.enabled !== false)
  const sellerHasMp = sellerHasMpConnected(shopMeta)
  const hasBuyablePrice = !!(listing.price_cents && listing.price_cents > 0)
  const repuve = listing.metadata?.repuve as { status?: string; folio?: string; verified_at?: string } | undefined
  const showRepuve = listing.category === 'autos' && !!repuve?.status
  const shopSettings = (shopMeta?.settings ?? {}) as Record<string, unknown>
  const calcomSettings = shopSettings.calcom as { connected?: boolean; booking_url?: string; event_type_title?: string } | undefined
  const ordersSettings = shopSettings.orders as { processing_time?: string } | undefined
  const returnsPolicySettings = shopSettings.returns_policy as { window?: string; conditions?: string; shipping_paid_by?: string; custom_note?: string } | undefined
  const checkoutSettings = shopSettings.checkout as {
    show_phone?: boolean
    phone?: string | null
    whatsapp_cta?: boolean
    show_email?: boolean
    contact_email?: string | null
    bank_transfer?: { clabe?: string | null; bank_name?: string | null; account_holder?: string | null }
  } | undefined
  const themeSettings = shopSettings.theme as { social?: { whatsapp?: string | null } } | undefined
  const shippingSettings = shopSettings.shipping as {
    local_pickup?: boolean
    pickup_spots?: Array<{ name?: string; address?: string; instructions?: string }>
  } | undefined
  const schedulingSettings = shopSettings.scheduling as { links?: Array<{ label?: string; url?: string }> } | undefined
  type BundleTier = { min_items: number; percent_off: number }
  const bundleConfig = shopSettings.bundles as { enabled?: boolean; tiers?: BundleTier[] } | undefined
  const shopBundleTiers: BundleTier[] = bundleConfig?.enabled ? (bundleConfig.tiers ?? []) : []
  const visiblePhone = checkoutSettings?.show_phone && checkoutSettings.phone ? checkoutSettings.phone : null
  const whatsappPhone = checkoutSettings?.whatsapp_cta
    ? (themeSettings?.social?.whatsapp || checkoutSettings?.phone || null)
    : null
  const contactEmail = checkoutSettings?.show_email ? checkoutSettings.contact_email ?? null : null
  const schedulingLinks = (schedulingSettings?.links ?? []).filter((link): link is { label?: string; url: string } => !!link.url)
  const bookingUrl = calcomSettings?.connected && calcomSettings.booking_url
    ? calcomSettings.booking_url
    : schedulingLinks[0]?.url ?? null
  const bookingText = calcomSettings?.event_type_title ?? schedulingLinks[0]?.label ?? null
  const pickupSpots = shippingSettings?.local_pickup ? (shippingSettings.pickup_spots ?? []) : []
  const PROCESSING_LABELS: Record<string, string> = { '1d': '1 día hábil', '1-3d': '1–3 días hábiles', '3-5d': '3–5 días hábiles', '1-2w': '1–2 semanas' }
  const processingLabel = ordersSettings?.processing_time ? PROCESSING_LABELS[ordersSettings.processing_time] ?? ordersSettings.processing_time : null
  // Only show a positive return window as a trust signal — "no returns" is never surfaced
  // on the PDP (it's the implicit default and negative framing; disputes still apply via
  // platform protection regardless of seller policy).
  const returnsLabel = returnsPolicySettings?.window === '7d'  ? '7 días'
    : returnsPolicySettings?.window === '14d' ? '14 días'
    : returnsPolicySettings?.window === '30d' ? '30 días'
    : null
  const isSubscription = (listing.listing_type as string) === 'subscription'
  type StoredTier = { id: string; label: string; price_cents: number; interval: 'month' | 'year'; features: string[]; is_highlighted: boolean; stripe_price_id?: string; mp_preapproval_plan_id?: string }
  const storedTiers = listing.metadata?.subscription_tiers as StoredTier[] | undefined
  const subMeta = listing.metadata?.subscription as { interval?: 'month' | 'year'; content_description?: string; stripe_price_id?: string } | undefined
  const subTiers: StoredTier[] = storedTiers && storedTiers.length > 0
    ? storedTiers
    : subMeta ? [{ id: 'default', label: 'Suscripción', price_cents: listing.price_cents ?? 0, interval: subMeta.interval ?? 'month', features: subMeta.content_description ? subMeta.content_description.split('\n').filter(Boolean) : [], is_highlighted: false, stripe_price_id: subMeta.stripe_price_id }] : []
  const hasClabe = !!(checkoutSettings?.bank_transfer?.clabe?.trim() && checkoutSettings.bank_transfer.clabe.trim().length === 18)
  const shopHasScheduling = !!bookingUrl
  const agendarLabel = listing.category === 'autos' ? '🚗 Agendar prueba de manejo' : listing.category === 'inmuebles' ? '🏠 Agendar visita' : listing.listing_type === 'service' ? '🕐 Agendar cita' : listing.listing_type === 'rental' ? '📅 Ver disponibilidad' : '📅 Agendar'
  const hasDirectContact = !!(whatsappPhone || visiblePhone || contactEmail || bookingUrl)
  const paymentMethods = [
    sellerHasMp && !isDigital && { icon: 'iconoir-credit-card', label: 'Mercado Pago', note: 'Tarjeta, wallet, OXXO' },
    sellerHasStripe && { icon: 'iconoir-credit-card', label: 'Tarjeta', note: 'Stripe Connect' },
    hasClabe && { icon: 'iconoir-bank', label: 'SPEI', note: checkoutSettings?.bank_transfer?.bank_name ?? 'Transferencia bancaria' },
    whatsappPhone && { icon: 'iconoir-chat-bubble', label: 'WhatsApp', note: 'Acordar directo' },
    bookingUrl && { icon: 'iconoir-calendar', label: 'Agenda', note: bookingText ?? 'Reservar horario' },
  ].filter(Boolean) as Array<{ icon: string; label: string; note: string }>
  // Seller offers at least one online/selectable payment path → show the single
  // "Comprar ahora" button (the checkout page is the method chooser).
  const hasAnyPayment = sellerHasMp || sellerHasStripe || hasClabe
  const fulfillmentMethods = [
    shippingSettings?.local_pickup && {
      icon: 'iconoir-shop',
      label: 'Recolección local',
      note: pickupSpots.length > 1
        ? `${pickupSpots.length} puntos de entrega — elige al pagar`
        : pickupSpots[0]?.name
          ? `${pickupSpots[0].name}${pickupSpots[0].address ? ` · ${pickupSpots[0].address}` : ''}`
          : 'Punto de entrega — coordina con la tienda',
    },
    isDigital && { icon: 'iconoir-download', label: 'Entrega digital', note: 'Disponible al pagar' },
    listing.listing_type === 'service' && { icon: 'iconoir-calendar', label: 'Servicio', note: bookingUrl ? 'Agenda disponible' : 'Coordina con el vendedor' },
    listing.listing_type === 'rental' && { icon: 'iconoir-calendar', label: 'Renta', note: bookingUrl ? 'Ver disponibilidad' : 'Coordina fechas' },
    processingLabel && { icon: 'iconoir-box', label: 'Preparación', note: processingLabel },
  ].filter(Boolean) as Array<{ icon: string; label: string; note: string }>

  // Check if favorited
  let isFavorited = false
  if (clerkUser) {
    const { data: fav } = await db
      .from('marketplace_favorites')
      .select('id, marketplace_listings!inner(medusa_product_id)')
      .eq('clerk_user_id', clerkUser.id)
      .eq('marketplace_listings.medusa_product_id', id)
      .maybeSingle()
    isFavorited = !!fav
  }

  const activeDeal = await getActiveDealForBuyer(id, clerkUser?.id)
  const agreedDealCents = activeDeal?.status === 'accepted_unpaid' && activeDeal.dealPriceCents ? activeDeal.dealPriceCents : null
  const activeDealCurrency = activeDeal?.currency ?? listing.currency
  const effectivePrice = agreedDealCents
    ? formatOfferAmount(agreedDealCents, activeDealCurrency)
    : formatPrice(listing)
  const showBuyerActions = isClaimed && !isOwnListing
  // Sold out only when Medusa Inventory tracks the item and stock hit 0. Legacy
  // (unmanaged) listings have in_stock === undefined → never blocked.
  const soldOut = listing.in_stock === false
  const showBuyButtons = !isDigital && !isSubscription && hasBuyablePrice && showBuyerActions && !soldOut
  const images = listing.images ?? []

  const currentBundleItem = showBuyButtons && listing.shop ? {
    productId: listing.id,
    variantId: null,
    sellerId: listing.shop.id,
    sellerSlug: listing.shop.slug,
    sellerName: listing.shop.name,
    title: listing.title,
    price_cents: listing.price_cents!,
    currency: listing.currency,
    imageUrl: listing.images?.[0]?.url ?? null,
    listing_type: listing.listing_type,
    paymentMethods: { stripe: sellerHasStripe, mp: sellerHasMp, spei: hasClabe },
  } : null

  const bundleListings = showBuyButtons && listing.shop?.slug
    ? (await getShopListings(listing.shop.slug))
        .filter(item =>
          item.id !== listing.id &&
          item.status === 'active' &&
          item.listing_type === 'product' &&
          // Don't suggest sold-out items for a bundle — they'd fail at checkout's
          // inventory reservation. in_stock === undefined (unmanaged) is allowed.
          item.in_stock !== false &&
          !!item.price_cents &&
          item.price_cents > 0
        )
        .slice(0, 5)
    : []
  const bundleItems = currentBundleItem ? [
    currentBundleItem,
    ...bundleListings.map(item => ({
      productId: item.id,
      variantId: null,
      sellerId: listing.shop!.id,
      sellerSlug: listing.shop!.slug,
      sellerName: listing.shop!.name,
      title: item.title,
      price_cents: item.price_cents!,
      currency: item.currency,
      imageUrl: item.images?.[0]?.url ?? null,
      listing_type: item.listing_type,
      paymentMethods: { stripe: sellerHasStripe, mp: sellerHasMp, spei: hasClabe },
    })),
  ] : []

  // Reusable CTA buttons block (rendered both inline on desktop and in sticky bar on mobile)
  const ctaButtons = showBuyerActions ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {activeDeal?.status === 'accepted_unpaid' && agreedDealCents && (
        <div style={{ padding: 12, background: 'var(--success-soft)', border: '1.5px solid var(--success)', borderRadius: 'var(--r-lg)' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 2 }}>Tu precio acordado</p>
          <p style={{ fontSize: 22, fontWeight: 800 }}>{formatOfferAmount(agreedDealCents, activeDeal.currency)}</p>
          {listing.price_cents && (
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Precio original: <span style={{ textDecoration: 'line-through' }}>{formatCents(listing.price_cents, listing.currency)}</span></p>
          )}
        </div>
      )}
      {activeDeal?.status === 'pending' && (
        <div style={{ padding: 12, background: 'var(--warning-soft)', border: '1.5px solid var(--warning)', borderRadius: 'var(--r-lg)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)' }}>Tu oferta está pendiente</p>
          {activeDeal.dealPriceCents && <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>Oferta enviada: {formatOfferAmount(activeDeal.dealPriceCents, activeDeal.currency)}</p>}
        </div>
      )}
      {activeDeal?.status === 'countered' && (
        <div style={{ padding: 12, background: 'var(--info-soft)', border: '1.5px solid var(--info)', borderRadius: 'var(--r-lg)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--info)' }}>El vendedor hizo una contraoferta</p>
          {activeDeal.dealPriceCents && <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--info)', marginTop: 2 }}>{formatOfferAmount(activeDeal.dealPriceCents, activeDeal.currency)}</p>}
          {activeDeal.conversationId && <Link href={`/messages/${activeDeal.conversationId}`} style={{ fontSize: 12, color: 'var(--info)', textDecoration: 'underline' }}>Responder en mensajes</Link>}
        </div>
      )}
      {/* Print-ad placement → funnel into the ad builder (captures ad content),
          NOT the generic PDP checkout. */}
      {isPrintPlacement && (
        <Link
          href={printEditionId ? `/sell/print/${printEditionId}` : '/shop/manage'}
          className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
          style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
        >
          🗞️ Diseña tu anuncio impreso
        </Link>
      )}
      {/* Single "Comprar ahora" → unified checkout, where the buyer picks the
          payment method among the ones the seller has enabled. No provider is
          hardcoded here; the checkout page is the single chooser. */}
      {!isPrintPlacement && showBuyButtons && activeDeal?.status !== 'pending' && activeDeal?.status !== 'countered' && (
        hasAnyPayment ? (
          agreedDealCents && activeDeal ? (
            <OfferCheckoutButton listingId={listing.id} offerId={activeDeal.offerId} amountCents={agreedDealCents} currency={activeDeal.currency} isSignedIn={isSignedIn} />
          ) : isSignedIn ? (
            <Link href={`/checkout?listingId=${listing.id}`} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}>
              Comprar ahora — {effectivePrice}
            </Link>
          ) : (
            <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/checkout?listingId=${listing.id}`)}`} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}>
              Inicia sesión para comprar
            </Link>
          )
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center', padding: '0 8px' }}>
            Contacta al vendedor para pagar
          </div>
        )
      )}
      {!isPrintPlacement && hasBuyablePrice && activeDeal?.status !== 'accepted_unpaid' && (
        <MakeOfferButton
          listing={{ id: listing.id, title: listing.title, price_cents: listing.price_cents!, currency: listing.currency, imageUrl: listing.images?.[0]?.url ?? null }}
          buyerInfo={clerkUser ? { name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' '), email: clerkUser.emailAddresses[0]?.emailAddress ?? '' } : undefined}
          isSignedIn={isSignedIn}
        />
      )}
      {activeDeal?.status === 'accepted_unpaid' && activeDeal.conversationId && (
        <Link href={`/messages/${activeDeal.conversationId}`} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ border: '1.5px solid var(--border)', color: 'var(--fg)', background: 'var(--bg-elevated)' }}>
          <i className="iconoir-message-text" style={{ fontSize: 16 }} />
          Ver conversación
        </Link>
      )}
      <AskSellerButton listingId={listing.id} isSignedIn={isSignedIn} />
    </div>
  ) : isOwnListing ? (
    <Link href={`/sell/edit/${listing.id}`} className="btn btn-dark btn-lg no-underline" style={{ width: '100%', justifyContent: 'center' }}>
      Editar anuncio
    </Link>
  ) : null

  return (
    /* Mobile: single-col centered. Desktop: unconstrained width up to 960px, 2-col grid */
    <div
      className="max-w-[640px] md:max-w-[960px] mx-auto pb-[120px] md:px-6 md:pb-12"
    >
      {/* ── Desktop 2-col grid ──────────────────────────────────────────────── */}
      <div className="md:grid md:gap-10 md:[grid-template-columns:46%_1fr]">

      {/* ═══════════════════ LEFT COLUMN: Gallery (sticky on desktop) ════════ */}
      <div className="md:col-start-1 md:row-start-1">
        {/* Sticky wrapper — desktop only */}
        <div className="md:sticky md:top-[72px]">
          {/* ── Image gallery ───────────────────────────────────────────── */}
          <div style={{ position: 'relative' }}>
            {images.length === 0 ? (
              <div style={{ width: '100%', aspectRatio: '4/3', background: 'var(--bg-sunk)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="iconoir-package" style={{ fontSize: 64, color: 'var(--fg-subtle)' }} />
              </div>
            ) : images.length === 1 ? (
              <img src={images[0].url} alt={listing.title} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block', borderRadius: 'var(--r-lg)' }} className="md:rounded-xl" />
            ) : (
              <div>
                <img src={images[0].url} alt={listing.title} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} className="md:rounded-xl" />
                <div style={{ display: 'flex', gap: 4, padding: '4px 4px 0', overflowX: 'auto', background: 'var(--bg-sunk)' }} className="hide-scrollbar md:rounded-b-xl">
                  {images.slice(1).map((img, i) => (
                    <img key={i} src={img.url} alt="" style={{ height: 64, width: 64, objectFit: 'cover', borderRadius: 4, flexShrink: 0, opacity: 0.85 }} />
                  ))}
                </div>
              </div>
            )}

            {/* Favorite button overlay */}
            <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
              <FavoriteButton listingId={listing.id} initialFavorited={isFavorited} isSignedIn={isSignedIn} />
            </div>

            {/* Views badge */}
            <div style={{ position: 'absolute', bottom: images.length > 1 ? 76 : 12, left: 12, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <i className="iconoir-eye" style={{ fontSize: 12, color: '#fff' }} />
              <span style={{ fontSize: 11, color: '#fff', fontWeight: 500 }}>{listing.views}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════ RIGHT COLUMN: Content ═══════════════════════════ */}
      <div className="md:col-start-2 md:row-start-1">

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 16px 0' }} className="md:pt-0 md:px-0">

        {/* Breadcrumbs */}
        <nav style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--fg-subtle)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Inicio</Link>
          <span>›</span>
          <Link href="/l" style={{ color: 'var(--fg-subtle)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Anuncios</Link>
          {listing.category && (<><span>›</span><Link href={`/l?category=${listing.category}`} style={{ color: 'var(--fg-subtle)', textDecoration: 'none' }} className="hover:text-[var(--fg)] capitalize">{listing.category}</Link></>)}
        </nav>

        {/* Title + meta */}
        <h1 style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.3, marginBottom: 4 }}>{listing.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {listing.condition && (
            <span style={{ fontSize: 12, fontWeight: 500, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>
              {conditionLabel(listing.condition)}
            </span>
          )}
          <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{timeAgo(listing.created_at)}</span>
          {listing.location && (
            <span style={{ fontSize: 12, color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <i className="iconoir-map-pin" style={{ fontSize: 11 }} />{listing.location}
            </span>
          )}
        </div>

        {/* Price */}
        <div style={{ marginBottom: (processingLabel || returnsLabel) ? 10 : 16 }}>
          {agreedDealCents && (
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 3 }}>Tu precio acordado</p>
          )}
          <p style={{ fontWeight: 800, fontSize: 28, color: 'var(--fg)', lineHeight: 1 }}>{effectivePrice}</p>
          {soldOut && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--r-pill)', padding: '4px 10px' }}>
              <i className="iconoir-cancel" style={{ fontSize: 12 }} />
              Agotado
            </span>
          )}
          {agreedDealCents && listing.price_cents && (
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 3 }}>
              Precio original: <span style={{ textDecoration: 'line-through' }}>{formatCents(listing.price_cents, listing.currency)}</span>
            </p>
          )}
          {listing.currency && listing.currency !== 'MXN' && (
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{listing.currency}</p>
          )}
        </div>

        {/* Order info pills */}
        {(processingLabel || returnsLabel) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {processingLabel && (
              <span style={{ fontSize: 12, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <i className="iconoir-box" style={{ fontSize: 11 }} />
                Lista en {processingLabel}
              </span>
            )}
            {returnsLabel && (
              <span style={{ fontSize: 12, background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <i className="iconoir-undo" style={{ fontSize: 11 }} />
                Devoluciones: {returnsLabel}
              </span>
            )}
          </div>
        )}

        {(paymentMethods.length > 0 || fulfillmentMethods.length > 0 || (!hasBuyablePrice && isClaimed)) && (
          <div style={{ marginBottom: 16, padding: '14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
            {!hasBuyablePrice && isClaimed && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: paymentMethods.length || fulfillmentMethods.length ? 12 : 0 }}>
                <i className="iconoir-message-text" style={{ fontSize: 18, color: 'var(--accent)', marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>Precio a consultar</p>
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                    {hasDirectContact ? 'Usa las opciones de contacto de la tienda para confirmar precio, pago y entrega.' : 'La tienda no publicó un precio para compra en línea.'}
                  </p>
                </div>
              </div>
            )}
            {!hasBuyablePrice && isClaimed && (
              <div style={{ marginBottom: paymentMethods.length || fulfillmentMethods.length ? 12 : 0 }}>
                <AskSellerButton listingId={listing.id} isSignedIn={isSignedIn} />
              </div>
            )}
            {paymentMethods.length > 0 && (
              <div style={{ marginBottom: fulfillmentMethods.length > 0 ? 12 : 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Métodos disponibles</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
                  {paymentMethods.map(method => (
                    <div key={method.label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--r-md)', background: 'var(--bg-sunk)' }}>
                      <i className={method.icon} style={{ fontSize: 15, color: 'var(--accent)', flexShrink: 0 }} />
                      <div className="min-w-0">
                        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{method.label}</p>
                        <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{method.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {fulfillmentMethods.length > 0 && (
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Entrega y disponibilidad</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
                  {fulfillmentMethods.map(method => (
                    <div key={method.label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--r-md)', background: 'var(--bg-sunk)' }}>
                      <i className={method.icon} style={{ fontSize: 15, color: 'var(--accent)', flexShrink: 0 }} />
                      <div className="min-w-0">
                        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>{method.label}</p>
                        <p style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{method.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Badges ──────────────────────────────────────────────────────────── */}
        {isDigital && digitalFile && (
          <div className="flex items-center gap-2" style={{ background: 'var(--agent-soft)', borderRadius: 'var(--r-md)', padding: '10px 12px', marginBottom: 12 }}>
            <i className="iconoir-pc-mouse" style={{ fontSize: 20, color: 'var(--agent)', flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--agent)' }}>Producto digital — entrega automática</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {digitalFile.label} · {digitalFile.name}
                {digitalFile.size && ` · ${(digitalFile.size / 1024 / 1024).toFixed(1)} MB`}
              </div>
            </div>
          </div>
        )}

        {showRepuve && (
          <div className="flex items-center gap-2" style={{ background: repuve!.status === 'sin_reporte' ? 'var(--success-soft)' : 'var(--danger-soft)', borderRadius: 'var(--r-md)', padding: '10px 12px', marginBottom: 12 }}>
            <i className={repuve!.status === 'sin_reporte' ? 'iconoir-check-circle' : 'iconoir-warning-triangle'} style={{ fontSize: 18, color: repuve!.status === 'sin_reporte' ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: repuve!.status === 'sin_reporte' ? 'var(--success)' : 'var(--danger)' }}>
                {repuve!.status === 'sin_reporte' ? 'Sin reporte REPUVE' : 'Con reporte REPUVE'}
              </span>
              {repuve!.folio && <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.7 }}>Folio: {repuve!.folio}</span>}
            </div>
          </div>
        )}

        {/* ── Desktop inline CTAs (buy now + make offer) ─────────────────────── */}
        {showBuyButtons && (
          <div className="hidden md:block" style={{ marginBottom: 20, padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
            {ctaButtons}
          </div>
        )}

        {/* ── Sold-out notice (replaces buy CTAs) ─────────────────────────────── */}
        {soldOut && showBuyerActions && !isDigital && !isSubscription && hasBuyablePrice && (
          <div style={{ marginBottom: 20, padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
            <i className="iconoir-cancel" style={{ fontSize: 22, color: 'var(--danger)' }} />
            <p style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>Artículo agotado</p>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>Este artículo ya se vendió y no está disponible.</p>
          </div>
        )}

        {/* ── Subscription CTA (inline, not sticky) ───────────────────────────── */}
        {isSubscription && subTiers.length > 0 && isClaimed && (
          <div style={{ marginBottom: 20 }}>
            <SubscriptionSection
              listingId={listing.id}
              tiers={subTiers}
              shopName={listing.shop?.name ?? ''}
              hasStripe={sellerHasStripe}
              hasClabe={hasClabe}
              hasMp={sellerHasMp}
              isSignedIn={isSignedIn}
              buyerDisplayName={clerkUser ? [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') : undefined}
              buyerUserEmail={clerkUser?.emailAddresses[0]?.emailAddress}
            />
          </div>
        )}

        {/* ── Digital buy (inline, not sticky) ────────────────────────────────── */}
        {isDigital && hasBuyablePrice && (
          <div style={{ background: 'var(--agent-soft)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 20 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
              <i className="iconoir-download-circle-solid" style={{ fontSize: 22, color: 'var(--agent)' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--agent)' }}>Entrega automática al instante</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Recibirás el archivo al completar el pago.</div>
              </div>
            </div>
            <BuyButton listingId={listing.id} price={formatPrice(listing)} isDigital sellerHasStripe={sellerHasStripe} isSignedIn={isSignedIn} />
          </div>
        )}

        {/* ── Seller card ──────────────────────────────────────────────────────── */}
        {listing.shop && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 20 }}>
            <Link href={onChannel ? '/' : `/s/${listing.shop.slug}`} className="no-underline block">
              <div className="flex items-center gap-3" style={{ padding: '14px 16px' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {listing.shop.logo_url ? (
                    <img src={listing.shop.logo_url as unknown as string} alt={listing.shop.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <i className="iconoir-shop" style={{ fontSize: 20, color: 'var(--accent)' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
                      {listing.shop.verified && <span style={{ color: 'var(--accent)', marginRight: 3 }}>✓</span>}
                      {listing.shop.name}
                    </span>
                  </div>
                  {listing.shop.location && (
                    <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>
                      <i className="iconoir-map-pin" style={{ fontSize: 11, verticalAlign: 'middle', marginRight: 2 }} />
                      {listing.shop.location}
                    </p>
                  )}
                </div>
                <i className="iconoir-arrow-right" style={{ fontSize: 16, color: 'var(--fg-subtle)', flexShrink: 0 }} />
              </div>
            </Link>

            {/* Contact */}
            {(whatsappPhone || visiblePhone || contactEmail) && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  {whatsappPhone && (
                    <a
                      href={whatsappUrl(whatsappPhone, listing.title)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-lg no-underline"
                      style={{ width: '100%', justifyContent: 'center', background: '#25D366', color: '#fff', borderRadius: 'var(--r-pill)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      Contactar por WhatsApp
                    </a>
                  )}
                  {visiblePhone && (
                    <a href={`tel:${visiblePhone}`} className="btn btn-lg no-underline" style={{ width: '100%', justifyContent: 'center' }}>
                      <i className="iconoir-phone" style={{ fontSize: 16 }} />
                      Llamar al vendedor
                    </a>
                  )}
                  {contactEmail && (
                    <a href={`mailto:${contactEmail}?subject=${encodeURIComponent(`Consulta por ${listing.title}`)}`} className="btn btn-lg no-underline" style={{ width: '100%', justifyContent: 'center' }}>
                      <i className="iconoir-mail" style={{ fontSize: 16 }} />
                      Enviar correo
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Scheduling */}
            {shopHasScheduling && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
                <a href={bookingUrl!} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-lg no-underline" style={{ width: '100%', justifyContent: 'center' }}>
                  <i className="iconoir-calendar" style={{ fontSize: 16 }} />
                  {bookingText ?? agendarLabel.replace(/^[^\s]+\s/, '')}
                  <i className="iconoir-arrow-up-right" style={{ fontSize: 12, opacity: 0.6 }} />
                </a>
              </div>
            )}

            {pickupSpots.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Recoger en tienda</p>
                <div style={{ display: 'grid', gap: 8 }}>
                  {pickupSpots.slice(0, 3).map((spot, index) => (
                    <div key={`${spot.name ?? 'punto'}-${index}`} style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                      <strong style={{ color: 'var(--fg)' }}>{spot.name ?? `Punto ${index + 1}`}</strong>
                      {spot.address && <span> · {spot.address}</span>}
                      {spot.instructions && <p style={{ marginTop: 2 }}>{spot.instructions}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Claim nudge */}
            {!isClaimed && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', background: 'var(--bg-sunk)' }}>
                <Link href={`/s/${listing.shop.slug}/claim`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                  ¿Es tuya esta tienda? Reclamar gratis →
                </Link>
              </div>
            )}
          </div>
        )}

        {bundleItems.length > 1 && listing.shop && (
          <SellerBundleSection sellerName={listing.shop.name} items={bundleItems} bundleTiers={shopBundleTiers} />
        )}

        {/* ── Description ──────────────────────────────────────────────────────── */}
        {listing.description && (
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Descripción</h2>
            <p style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{listing.description}</p>
          </div>
        )}

        {returnsLabel && (
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Política de devoluciones</h2>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              Acepta devoluciones durante {returnsLabel.toLowerCase()}
              {returnsPolicySettings?.conditions === 'unopened' ? ' si el producto sigue cerrado' : ''}
              {returnsPolicySettings?.conditions === 'original' ? ' si se entrega en su estado original' : ''}
              {returnsPolicySettings?.shipping_paid_by === 'seller' ? '. El vendedor cubre el envío de devolución.' : '. El comprador cubre el envío de devolución.'}
            </p>
            {returnsPolicySettings?.custom_note && (
              <p style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.5, marginTop: 6 }}>{returnsPolicySettings.custom_note}</p>
            )}
          </div>
        )}

        {/* ── Source link ──────────────────────────────────────────────────────── */}
        {listing.source_url && (
          <div style={{ marginBottom: 20 }}>
            <a href={listing.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Ver anuncio original
              <i className="iconoir-arrow-up-right" style={{ fontSize: 12 }} />
              {listing.source_platform && <span style={{ fontSize: 11, background: 'var(--bg-sunk)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 4, textTransform: 'capitalize' }}>{listing.source_platform.replace('_', ' ')}</span>}
            </a>
          </div>
        )}

        {/* Tags */}
        {listing.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
            {listing.tags.map(tag => (
              <Link key={tag} href={`/l?q=${encodeURIComponent(tag)}`} className="chip no-underline" style={{ fontSize: 12, padding: '4px 12px' }}>{tag}</Link>
            ))}
          </div>
        )}
      </div>
      </div>{/* end right column */}

      </div>{/* end 2-col grid */}

      {/* ── Sticky CTA bar — mobile only ────────────────────────────────────────
          Hidden on desktop (md+); desktop shows CTAs inline above seller card.
          Only shown for physical/service products. Digital + subscriptions render
          their CTAs inline because they have extra context (tiers, file info). */}
      {showBuyButtons && (
        <div
          className="md:hidden"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 80,
            background: 'var(--bg-elevated)',
            borderTop: '1px solid var(--border)',
            padding: '12px 16px',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
            backdropFilter: 'blur(20px)',
          }}
        >
          {ctaButtons}
        </div>
      )}
    </div>
  )
}
