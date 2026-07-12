import { notFound, permanentRedirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { getListing, getShopListings, getPriceGrid, formatPrice, conditionLabel } from '@/lib/listings'
import ConfiguratorBuyBox from './ConfiguratorBuyBox'
import { isLikelyListingId } from '@/lib/route-shape'
import { listingTypeFrame } from '@/lib/listing-query'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'
import { getShopStripe } from '@/lib/stripe'
import { sellerHasMpConnected } from '@/lib/mercadopago-connect'
import { isShopClaimed } from '@/lib/claim'
import BuyButton from '@/app/components/BuyButton'
import PersonalizationBuyBox from '@/app/components/PersonalizationBuyBox'
import { getCustomFields } from '@/lib/personalization'
import { ensureUrlProtocol } from '@/lib/url'
import { readEventDetails } from '@/lib/event-listing'
import MakeOfferButton from '@/app/components/MakeOfferButton'
import FavoriteButton from '@/app/components/FavoriteButton'
import AskSellerButton from '@/app/components/AskSellerButton'
import OfferCheckoutButton from '@/app/components/OfferCheckoutButton'
import SellerBundleSection from '@/app/components/SellerBundleSection'
import SpecsTable from './SpecsTable'
import { listingSpecs } from '@/lib/listing-attributes'
import SellerTrustCard from '@/app/components/SellerTrustCard'
import TrustSignals from '@/app/components/TrustSignals'
import SubscriptionSection from './SubscriptionSection'
import ServiceHero from './ServiceHero'
import AutoHero from './AutoHero'
import InmuebleHero from './InmuebleHero'
import EventHero from './EventHero'
import EventBuyBox from './EventBuyBox'
import { eventHeroModel } from '@/lib/event-hero'
import { ticketQuantityCap } from '@/lib/ticket-quantity'
import UnclaimedNotice from './UnclaimedNotice'
import RentalBooking from './RentalBooking'
import Gallery from './Gallery'
import { SetAgentContext } from '@/app/components/AgentContext'
import StickyBuyBar from './StickyBuyBar'
import CollapsibleDescription from './CollapsibleDescription'
import ExcerptPanel from './ExcerptPanel'
import { excerptModel } from '@/lib/excerpt'
import { db } from '@/lib/supabase'
import { getActiveDealForBuyer } from '@/lib/active-deal'
import { formatOfferAmount } from '@/lib/offers'
import { shouldShowSaveCount, saveCountLabel, isNewListing } from '@/lib/pdp-liveness'
import { isEnabled } from '@/lib/flags'
import { derivePdpBarMode } from '@/lib/pdp-bar'
import { toRatePeriod, readDepositCents } from '@/lib/rental-pricing'
import { digitalFileInfo, digitalSpecs } from '@/lib/digital-delivery'
import { deriveInventoryMode, deriveBuyBoxBehavior } from '@/lib/inventory-mode'
import { PROCESSING_LABELS } from '@/lib/trust-inputs'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  if (!isLikelyListingId(id)) return { title: 'Anuncio no encontrado' }
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

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Short-circuit junk URLs BEFORE any Medusa fetch (epic 09 · cost reduction
  // S2.2): a clearly-malformed id can never be a real product, so 404 it without
  // paying a Store API round-trip. A well-formed-but-deleted id passes here and
  // 404s cleanly below via getListing → notFound(). On platform hosts middleware
  // already 404s these (with a cache header) before the function is invoked; this
  // guard also covers custom-domain / subdomain channels, where /l/[id] passes
  // through middleware untouched.
  if (!isLikelyListingId(id)) notFound()
  const [listing, clerkUser, priceGrid, configuratorFlagOn] = await Promise.all([
    getListing(id), currentUser(), getPriceGrid(id), isEnabled('configurator.enabled'),
  ])
  if (!listing) notFound()
  // Show the configurator buy box whenever there's real multi-variant choice
  // OR real quantity tiers to expose — either alone needs the live price
  // grid + qty stepper, since the plain buy box has no quantity control at
  // all. A single-variant listing CAN have quantity tiers on its own variant
  // (Story 2.2's variant_tiers write path doesn't require option_dimensions
  // first) — gating on variants.length > 1 alone would trap that seller's
  // bulk pricing behind a buy box that only ever checks out qty=1 (cross-
  // agent review catch, 2026-07-05). A legacy listing with no tiers at all
  // (price-grid absent or single flat tier) keeps today's PDP untouched.
  //
  // Deliberately NOT gated on `configurator.enabled` — this structural fact
  // (Sprint 2, already safely shipped) must stay true regardless of the
  // Sprint 3 flag. `hasConfigurator` also decides which checkout path a
  // buy click resolves to (lib/cart.ts throws if a genuinely multi-variant
  // product reaches checkout with no variantId), so flipping the flag off
  // must NOT reroute a real configurator listing into that broken plain-
  // checkout path — it would show a wrong ("desde $X" minimum) price
  // throughout checkout, then fail at pay-time instead of charging
  // correctly (cross-agent review catch, 2026-07-06). The flag instead
  // gates only the NEW Sprint 3 addition — see `configuratorFlagOn` below,
  // threaded into `customFields` at both render sites — so disabling it
  // reverts to Sprint 2's already-proven variant/tier buy box (no artwork/
  // personalization fields), never all the way back to a broken pre-
  // Sprint-2 checkout.
  const hasConfigurator = !!priceGrid
    && (priceGrid.variants.length > 1 || priceGrid.variants.some((v) => v.tiers.length > 1))

  // Custom-domain boundary: a tenant store shows ONLY its own products. If this
  // PDP is reached on a custom domain (channel slug set by middleware) but the
  // product belongs to another shop, render the white-label not-found instead of
  // leaking a different seller's listing under this brand.
  const reqHeaders = await headers()
  const channelSlug = reqHeaders.get('x-miyagi-shop-slug')
  const onChannel = !!channelSlug
  if (onChannel && listing.shop?.slug !== channelSlug) notFound()
  // On a custom domain the buyer can't sign in / pay (Clerk is platform-only), so
  // the buy + sign-in CTAs hop to the platform carrying this origin domain.
  const customDomain = onChannel ? reqHeaders.get('x-miyagi-domain') : null

  // SEO continuity: on the marketplace host, if this product's shop has a LIVE
  // custom domain, 308-redirect the legacy /l/[id] link to the tenant's own
  // domain so traffic + ranking consolidate there.
  if (!onChannel) {
    const domain = await getActiveCustomDomain(listing.shop?.slug ?? '')
    if (domain) permanentRedirect(`https://${domain}/l/${listing.id}`)
  }

  const isSignedIn = !!clerkUser
  const isOwnListing = !!clerkUser && listing.shop?.clerk_user_id === clerkUser.id
  // A shop is claimed only when it has a real owner (non-empty clerk_user_id that
  // isn't the legacy `pending:` placeholder). Gem-imported shops have
  // clerk_user_id = null and must stay contact-only — the previous check keyed off
  // shop.id (always present for a Medusa seller) so a null owner read as *claimed*
  // and the whole CTA tree rendered. Single source of truth: lib/claim.ts
  // (shared with the offers route + checkout-session). When false, the existing
  // showBuyerActions/showBuyButtons cascade hides Buy/Offer/Cart/Bundle and the
  // SellerTrustCard surfaces contact options + the "Reclamar" nudge instead.
  const isClaimed = isShopClaimed(listing.shop)
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
  const eventDetails = readEventDetails(listing)
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
  const themeSettings = shopSettings.theme as { social?: { whatsapp?: string | null }; accent_color?: string | null } | undefined
  // Own-shop premium presentation (epic 07, Sprint 1, Story 1.3) — applies the
  // seller's curated preset (surface tone + font pairing) here too, not just on
  // the shop page; absent key renders today's PDP unchanged.
  const shopAccent = themeSettings?.accent_color ?? 'var(--color-accent)'
  const themePreset = shopSettings.theme_preset as string | null | undefined
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
  const bookingUrl = ensureUrlProtocol(
    calcomSettings?.connected && calcomSettings.booking_url
      ? calcomSettings.booking_url
      : schedulingLinks[0]?.url
  )
  const bookingText = calcomSettings?.event_type_title ?? schedulingLinks[0]?.label ?? null
  const pickupSpots = shippingSettings?.local_pickup ? (shippingSettings.pickup_spots ?? []) : []
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

  // S2.2 liveness — how many people saved this listing (same join as above, count-only).
  // Threshold-gated at render so 0–1 saves never show (see lib/pdp-liveness.ts).
  const { count: saveCount } = await db
    .from('marketplace_favorites')
    .select('id, marketplace_listings!inner(medusa_product_id)', { count: 'exact', head: true })
    .eq('marketplace_listings.medusa_product_id', id)

  const activeDeal = await getActiveDealForBuyer(id, clerkUser?.id)
  const agreedDealCents = activeDeal?.status === 'accepted_unpaid' && activeDeal.dealPriceCents ? activeDeal.dealPriceCents : null
  const activeDealCurrency = activeDeal?.currency ?? listing.currency
  const effectivePrice = agreedDealCents
    ? formatOfferAmount(agreedDealCents, activeDealCurrency)
    : formatPrice(listing)
  const showBuyerActions = isClaimed && !isOwnListing
  // Inventory modes (catalog-management epic, Sprint 2 · Story 2.1) — a
  // "sobre pedido" (backorder) listing never blocks the buy box even at
  // qty 0 (Medusa's own reserveInventoryStep/completeCartWorkflow already
  // honor allow_backorder natively, no custom checkout code needed here).
  // Flag-gated: when OFF, force allow_backorder false so this reduces to
  // today's EXACT behavior (tracked-only — sold out only when Medusa
  // Inventory tracks the item and stock hit 0; unmanaged listings have
  // in_stock === undefined → never blocked) — the buyer-facing behavior
  // change is a true kill-switch, reading the fields themselves is not.
  const inventoryChannelsEnabled = await isEnabled('catalog.inventory_channels_enabled')
  const inventoryMode = deriveInventoryMode({
    manage_inventory: !!listing.manage_inventory,
    allow_backorder: inventoryChannelsEnabled ? !!listing.allow_backorder : false,
  })
  const buyBoxBehavior = deriveBuyBoxBehavior({ mode: inventoryMode, in_stock: listing.in_stock ?? true })
  const soldOut = buyBoxBehavior.blocked
  const dispatchEstimateLabel = listing.dispatch_estimate
    ? (PROCESSING_LABELS[listing.dispatch_estimate] ?? listing.dispatch_estimate)
    : null
  const showBuyButtons = !isDigital && !isSubscription && hasBuyablePrice && showBuyerActions && !soldOut
  // Personalization fields configured by the seller (Medusa product metadata).
  const customFields = getCustomFields(listing.metadata)
  const images = listing.images ?? []
  // PDP decision frame (S3.1) — leads the page with a type-appropriate label/hint.
  // null for `product` (the buy box is its frame). Same taxonomy as the chip rail.
  const typeFrame = listingTypeFrame(listing.listing_type)

  // PDP redesign kill-switch (epic 01). Default ENABLED (fail-open `true` in
  // lib/flags.ts) — flipping it OFF in /admin/flags reverts the whole product page to
  // the previous layout instantly. Every redesign delta below branches on this.
  const redesign = await isEnabled('pdp_redesign')

  // ══ Per-type heroes (S4) ════════════════════════════════════════════════════
  // A service leads with scheduling (S4.1) — not the boxed buy/offer bar — so when
  // `serviceLed`, the generic buy bar + bundle + generic specs/description are
  // suppressed and ServiceHero owns the action region. All redesign-gated, so the
  // kill-switch reverts to the old layout. (rentalLed is added in S4.2.)
  const isService = listing.listing_type === 'service'
  const serviceLed = redesign && isService && showBuyerActions
  // Rentals (S4.2) lead with a date-range picker → exact total (días × precio +
  // depósito). The rate is `price_cents` per `rate_period`; the deposit is a peso
  // amount captured in `metadata.attrs.deposit` (× 100 → cents). Both default
  // safely (deposit 0, period día) so a rental with no capture still works.
  const isRental = listing.listing_type === 'rental'
  const rentalAttrs = (listing.metadata?.attrs ?? {}) as Record<string, unknown>
  const rentalDepositCents = readDepositCents(rentalAttrs)
  const rentalPeriod = toRatePeriod(rentalAttrs.rate_period)
  const rentalLed = redesign && isRental && showBuyerActions && hasBuyablePrice
  // S2.2 — the flag that lets "Reservar estas fechas" deep-link to a real charge
  // instead of opening an AskSeller conversation. Read unconditionally (cheap,
  // cached) rather than gating on `rentalLed` so a stray future caller of
  // RentalBooking never accidentally inherits a stale default.
  const rentalPricingEnabled = isRental ? await isEnabled('checkout.rental_pricing_enabled') : false
  const suppressGenericBar = serviceLed || rentalLed
  // Digital (S4.3) leads with an "entrega al instante" banner; specs reinterpreted
  // as formato · tamaño. Digital already renders its buy inline (excluded from the
  // offer bar), so digitalLed only governs the hero banner + spec reinterpretation.
  const digitalLed = redesign && isDigital
  const digitalInfo = digitalLed ? digitalFileInfo(digitalFile) : null
  const digitalSpecRows = digitalLed ? digitalSpecs(digitalFile, listing.metadata) : []
  // Excerpt "Lee un adelanto" (bookshop launchpad S2.1) — a free text sample on a
  // digital listing. Renders whenever present (naturally dark: no excerpt exists
  // until a seller adds one with `launchpad.enabled` on); absent = today's PDP.
  const excerpt = isDigital ? excerptModel(listing.metadata) : null
  // Autos (S5.1) lead with the REPUVE verification anchor + the vehicle spec set
  // (the buyer's fraud anxiety first), with a primary "Agendar prueba de manejo".
  // The buy/offer bar stays available below (a car is buyable), so this is a
  // reorder: when `autoLed` the lower REPUVE badge + generic specs table are
  // suppressed so nothing duplicates. AutoHero owns the autos specs.
  const autoLed = redesign && listing.category === 'autos'
  // Inmuebles (S5.2) lead with a glanceable icon spec row (rec · baños · m² ·
  // estac.) + an approximate-zone map link + a primary "Agendar visita". The
  // icon row is a SUMMARY — the full property specs table (incl. tipo/amueblado)
  // stays below, so nothing is hidden and the generic specs are NOT suppressed.
  const inmuebleLed = redesign && listing.category === 'inmuebles'
  // Events / boletos (S5.3) lead with the event block (fecha · hora · lugar ·
  // dirección) and relabel the buy CTA to "Comprar boleto" — a ticket is a
  // buyable product; the webhooks issue the ticket on payment. The QR is reached
  // via a link to the buyer's order surface (the inline QR isn't cleanly
  // resolvable from the PDP read — see lib/event-hero.ts); aforo / tiers /
  // quantity are deferred (no live source). The lower event block is suppressed.
  const eventLed = redesign && !!eventDetails
  const eventModel = eventLed ? eventHeroModel() : null
  // Event admissions: how many tickets the buyer may pick (kill-switch + aforo).
  // cap <= 1 ⇒ no stepper (today's single-ticket <Link>); cap > 1 ⇒ EventBuyBox.
  const ticketQtyEnabled = eventModel ? await isEnabled('events.quantity_enabled') : false
  const ticketCap = eventModel
    ? ticketQuantityCap({ available: listing.available_quantity, enabled: ticketQtyEnabled })
    : 1
  const buyNowLabel = eventModel ? `${eventModel.buyLabel} — ${effectivePrice}` : `Comprar ahora — ${effectivePrice}`
  const signInBuyLabel = eventModel ? eventModel.signInLabel : 'Inicia sesión para comprar'
  // Unclaimed (S5.4) — gem-imported shop with no owner. Buy/Offer/Cart already
  // suppressed via isShopClaimed (no gating change); this only leads the page with
  // an honest "aún no reclamada" notice. SellerTrustCard already carries the
  // contact options + the claim nudge below.
  const unclaimedLed = redesign && !isClaimed && !!listing.shop?.slug

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
          <i className="iconoir-journal" aria-hidden /> Diseña tu anuncio impreso
        </Link>
      )}
      {/* Single "Comprar ahora" → unified checkout, where the buyer picks the
          payment method among the ones the seller has enabled. No provider is
          hardcoded here; the checkout page is the single chooser. */}
      {!isPrintPlacement && showBuyButtons && activeDeal?.status !== 'pending' && activeDeal?.status !== 'countered' && (
        hasAnyPayment ? (
          // An already-accepted offer ALWAYS takes priority over every other
          // buy box, even on a since-converted multi-variant listing — a
          // legacy accepted deal must stay payable (cross-agent review
          // catch, 2026-07-05: checking hasConfigurator first stranded an
          // accepted offer behind an unrelated buy box with no way to
          // actually redeem it). Then the configurator (multi-variant/
          // tiered) buy box, now passed `customFields` so a configurator
          // listing that ALSO has custom fields (e.g. a required artwork
          // upload, S3.1) renders variant/tier selection AND those fields
          // together — checking `customFields.length > 0` first here was a
          // real bug (S3 research, 2026-07-06): it silently ignored variant/
          // tier pricing on any configurator product that got a custom
          // field, since PersonalizationBuyBox has no variant/tier concept
          // at all. Plain `customFields.length > 0` now only fires for a
          // non-configurator personalized product.
          agreedDealCents && activeDeal ? (
            <OfferCheckoutButton listingId={listing.id} offerId={activeDeal.offerId} amountCents={agreedDealCents} currency={activeDeal.currency} isSignedIn={isSignedIn} customDomain={customDomain} />
          ) : hasConfigurator && priceGrid ? (
            <ConfiguratorBuyBox
              listingId={listing.id}
              priceGrid={priceGrid}
              isSignedIn={isSignedIn}
              customDomain={customDomain}
              currency={listing.currency}
              customFields={configuratorFlagOn ? customFields : []}
            />
          ) : customFields.length > 0 ? (
            <PersonalizationBuyBox
              listingId={listing.id}
              defs={customFields}
              isSignedIn={isSignedIn}
              customDomain={customDomain}
              priceLabel={effectivePrice}
              offerId={agreedDealCents && activeDeal ? activeDeal.offerId : undefined}
              buyNowLabel={eventModel ? buyNowLabel : undefined}
              signInBuyLabel={eventModel ? signInBuyLabel : undefined}
            />
          ) : isSignedIn ? (
            <Link href={checkoutHopHref(`/checkout?listingId=${listing.id}`, customDomain)} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}>
              Comprar ahora — {effectivePrice}
            </Link>
          ) : (
            <Link href={signInHopHref(`/checkout?listingId=${listing.id}`, customDomain)} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}>
              Inicia sesión para comprar
            </Link>
          )
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center', padding: '0 8px' }}>
            Contacta al vendedor para pagar
          </div>
        )
      )}
      {/* Negotiation doesn't compose with the configurator this sprint
          (Daniel-confirmed scope call) — never let a buyer OPEN a new offer
          on a multi-variant listing (an already-accepted legacy one still
          renders above via the ternary regardless of hasConfigurator). */}
      {!isPrintPlacement && hasBuyablePrice && !hasConfigurator && activeDeal?.status !== 'accepted_unpaid' && (
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

  // ══ PDP redesign · action region (S1.1 + S1.3) ══════════════════════════════
  // `derivePdpBarMode` picks exactly ONE mode, so an offer-status banner can never
  // stack on top of the buy buttons (the reported bug) and the `buy` mode has one
  // dominant primary CTA. Built independently from `ctaButtons` so flipping
  // `pdp_redesign` OFF renders the previous bar byte-for-byte (`ctaButtons` is
  // untouched). Both the desktop inline block and the mobile StickyBuyBar render
  // this same content.
  const barMode = derivePdpBarMode({
    showBuyButtons,
    isPrintPlacement,
    activeDealStatus: activeDeal?.status ?? null,
  })

  // Primary purchase CTA — shared by `buy` and `offer_accepted`. Mirrors the buy
  // logic in `ctaButtons` (personalization → offer-checkout → signed-in → signed-out),
  // with the no-online-payment fallback.
  const redesignPrimaryCta = hasAnyPayment ? (
    // Reordered (S3.4) — see the identical note + explanation in the legacy
    // `ctaButtons` block above: an accepted offer wins first, then the
    // configurator (now passed `customFields`), then plain personalization.
    agreedDealCents && activeDeal ? (
      <OfferCheckoutButton listingId={listing.id} offerId={activeDeal.offerId} amountCents={agreedDealCents} currency={activeDeal.currency} isSignedIn={isSignedIn} customDomain={customDomain} />
    ) : hasConfigurator && priceGrid ? (
      <ConfiguratorBuyBox
        listingId={listing.id}
        priceGrid={priceGrid}
        isSignedIn={isSignedIn}
        customDomain={customDomain}
        currency={listing.currency}
        customFields={configuratorFlagOn ? customFields : []}
      />
    ) : customFields.length > 0 ? (
      <PersonalizationBuyBox
        listingId={listing.id}
        defs={customFields}
        isSignedIn={isSignedIn}
        customDomain={customDomain}
        priceLabel={effectivePrice}
        offerId={agreedDealCents && activeDeal ? activeDeal.offerId : undefined}
        buyNowLabel={eventModel ? buyNowLabel : undefined}
        signInBuyLabel={eventModel ? signInBuyLabel : undefined}
      />
    ) : eventModel && ticketCap > 1 ? (
      // Paid event with > 1 seat (flag ON) → quantity stepper threads &qty=N.
      <EventBuyBox
        listingId={listing.id}
        unitCents={listing.price_cents!}
        currency={listing.currency}
        cap={ticketCap}
        isSignedIn={isSignedIn}
        customDomain={customDomain}
        buyLabelPrefix={eventModel.buyLabel}
        signInLabel={signInBuyLabel}
      />
    ) : isSignedIn ? (
      <Link href={checkoutHopHref(`/checkout?listingId=${listing.id}`, customDomain)} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}>
        {buyNowLabel}
      </Link>
    ) : (
      <Link href={signInHopHref(`/checkout?listingId=${listing.id}`, customDomain)} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}>
        {signInBuyLabel}
      </Link>
    )
  ) : (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center', padding: '0 8px' }}>
      Contacta al vendedor para pagar
    </div>
  )

  // "Preguntar" demoted to a light text link below the primary/secondary actions (S1.3).
  const redesignAskLink = <AskSellerButton listingId={listing.id} isSignedIn={isSignedIn} label="Preguntar" variant="link" />

  const redesignBarContent = (
    <div data-testid="pdp-action-bar" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {barMode === 'offer_accepted' && (
        <>
          {agreedDealCents && (
            <div style={{ padding: 12, background: 'var(--success-soft)', border: '1.5px solid var(--success)', borderRadius: 'var(--r-lg)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 2 }}>Tu precio acordado</p>
              <p style={{ fontSize: 22, fontWeight: 800 }}>{formatOfferAmount(agreedDealCents, activeDealCurrency)}</p>
              {listing.price_cents && (
                <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Precio original: <span style={{ textDecoration: 'line-through' }}>{formatCents(listing.price_cents, listing.currency)}</span></p>
              )}
            </div>
          )}
          {redesignPrimaryCta}
          {activeDeal?.conversationId && (
            <Link href={`/messages/${activeDeal.conversationId}`} className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors" style={{ border: '1.5px solid var(--border)', color: 'var(--fg)', background: 'var(--bg-elevated)' }}>
              <i className="iconoir-message-text" style={{ fontSize: 16 }} />
              Ver conversación
            </Link>
          )}
          {redesignAskLink}
        </>
      )}
      {barMode === 'offer_pending' && (
        <>
          <div style={{ padding: 12, background: 'var(--warning-soft)', border: '1.5px solid var(--warning)', borderRadius: 'var(--r-lg)' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)' }}>Tu oferta está pendiente</p>
            {activeDeal?.dealPriceCents && <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>Oferta enviada: {formatOfferAmount(activeDeal.dealPriceCents, activeDeal.currency)}</p>}
          </div>
          {redesignAskLink}
        </>
      )}
      {barMode === 'offer_countered' && (
        <>
          <div style={{ padding: 12, background: 'var(--info-soft)', border: '1.5px solid var(--info)', borderRadius: 'var(--r-lg)' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--info)' }}>El vendedor hizo una contraoferta</p>
            {activeDeal?.dealPriceCents && <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--info)', marginTop: 2 }}>{formatOfferAmount(activeDeal.dealPriceCents, activeDeal.currency)}</p>}
            {activeDeal?.conversationId && <Link href={`/messages/${activeDeal.conversationId}`} style={{ fontSize: 12, color: 'var(--info)', textDecoration: 'underline' }}>Responder en mensajes</Link>}
          </div>
          {redesignAskLink}
        </>
      )}
      {barMode === 'print_placement' && (
        <>
          <Link
            href={printEditionId ? `/sell/print/${printEditionId}` : '/shop/manage'}
            className="flex items-center justify-center gap-2 w-full font-semibold py-3 rounded-xl text-sm no-underline transition-colors"
            style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
          >
            <i className="iconoir-journal" aria-hidden /> Diseña tu anuncio impreso
          </Link>
          {redesignAskLink}
        </>
      )}
      {barMode === 'buy' && (
        <>
          {redesignPrimaryCta}
          {/* Negotiation doesn't compose with the configurator this sprint —
              see the identical note on the legacy ctaButtons block above. */}
          {hasBuyablePrice && !hasConfigurator && (
            <MakeOfferButton
              listing={{ id: listing.id, title: listing.title, price_cents: listing.price_cents!, currency: listing.currency, imageUrl: listing.images?.[0]?.url ?? null }}
              buyerInfo={clerkUser ? { name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' '), email: clerkUser.emailAddresses[0]?.emailAddress ?? '' } : undefined}
              isSignedIn={isSignedIn}
            />
          )}
          {redesignAskLink}
        </>
      )}
    </div>
  )

  // Seller trust block (S3.2) — built once, dual-rendered: mobile-only above the
  // payment/fulfillment methods box (so the buyer judges who they're buying from
  // first), desktop-only in its original position below. Same `md:hidden` /
  // `hidden md:block` idiom as `ctaButtons`.
  const sellerTrustCard = listing.shop ? (
    <SellerTrustCard
      shop={listing.shop}
      onChannel={onChannel}
      isClaimed={isClaimed}
      listingTitle={listing.title}
      whatsappPhone={whatsappPhone}
      visiblePhone={visiblePhone}
      contactEmail={contactEmail}
      bookingUrl={bookingUrl}
      bookingText={bookingText}
      agendarLabel={agendarLabel}
      pickupSpots={pickupSpots}
    />
  ) : null

  return (
    // Own-shop premium presentation (epic 07, Sprint 1, Story 1.3) — the preset
    // attribute must sit on a full-bleed wrapper, not the max-w-constrained
    // column below, or its surface color only paints the center column on wide
    // viewports (mirrors the shop page's outer/inner split, page.tsx).
    <div style={{ '--shop-accent': shopAccent } as React.CSSProperties} data-shop-preset={themePreset || undefined}>
    {/* Mobile: single-col centered. Desktop: unconstrained width up to 960px, 2-col grid.
       Redesign (S1.1): drop the fixed mobile `pb-[120px]` — StickyBuyBar renders a
       measured spacer matching the bar's real height instead, so content is never clipped. */}
    <div
      className={redesign ? 'max-w-[640px] md:max-w-[960px] mx-auto md:px-6 md:pb-12' : 'max-w-[640px] md:max-w-[960px] mx-auto pb-[120px] md:px-6 md:pb-12'}
    >
      {/* Push the product title + price into AgentContext so the navbar AI card's
          copied prompt names this product (S2.2). `effectivePrice` mirrors what the
          shopper sees; clears on navigation away. */}
      <SetAgentContext title={listing.title} price={effectivePrice} />
      {/* ── Desktop 2-col grid ──────────────────────────────────────────────── */}
      <div className="md:grid md:gap-10 md:[grid-template-columns:46%_1fr]">

      {/* ═══════════════════ LEFT COLUMN: Gallery (sticky on desktop) ════════ */}
      <div className="md:col-start-1 md:row-start-1">
        {/* Sticky wrapper — desktop only */}
        <div className="md:sticky md:top-[72px]">
          {/* ── Image gallery (client island; rest of PDP stays a Server
               Component). The FavoriteButton + views badge ride along as an
               `overlay` slot so they stay pinned over the image. ──────────── */}
          <Gallery
            images={images}
            title={listing.title}
            overlay={
              <>
                {/* Favorite button overlay */}
                <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
                  <FavoriteButton listingId={listing.id} initialFavorited={isFavorited} isSignedIn={isSignedIn} />
                </div>

                {/* Views badge */}
                <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="iconoir-eye" style={{ fontSize: 12, color: 'var(--fg-inverse)' }} />
                  <span style={{ fontSize: 11, color: 'var(--fg-inverse)', fontWeight: 500 }}>{listing.views}</span>
                </div>
              </>
            }
          />
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
          {/* S2.2 liveness — "Nuevo" badge for the first 48h (redesign-gated). */}
          {redesign && isNewListing(listing.created_at) && (
            <span data-testid="pdp-new-badge" style={{ fontSize: 12, fontWeight: 700, background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>
              Nuevo
            </span>
          )}
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
          {/* S2.2 liveness — "X personas lo guardaron", threshold-gated (redesign-only). */}
          {redesign && shouldShowSaveCount(saveCount) && (
            <span data-testid="pdp-save-count" style={{ fontSize: 12, color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <i className="iconoir-heart" style={{ fontSize: 11 }} />{saveCountLabel(saveCount!)}
            </span>
          )}
        </div>

        {/* ── Type frame (S3.1) — leads with a decision frame matching the listing
            type, so a service/rental/digital good isn't presented like a boxed
            product. `product` has no frame (its buy box leads). ──────────────── */}
        {typeFrame && (
          <div
            data-testid="pdp-type-frame"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--accent-soft)', borderRadius: 'var(--r-md)', marginBottom: 14 }}
          >
            <i className={typeFrame.icon} style={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
            <div className="min-w-0">
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{typeFrame.label}</p>
              <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{typeFrame.hint}</p>
            </div>
          </div>
        )}

        {/* Price */}
        <div style={{ marginBottom: (processingLabel || returnsLabel) ? 10 : 16 }}>
          {agreedDealCents && (
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 3 }}>Tu precio acordado</p>
          )}
          <p style={{ fontWeight: 800, fontSize: 28, color: 'var(--fg)', lineHeight: 1 }}>{effectivePrice}</p>
          {buyBoxBehavior.showAgotado && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--r-pill)', padding: '4px 10px' }}>
              <i className="iconoir-xmark" style={{ fontSize: 12 }} />
              Agotado
            </span>
          )}
          {buyBoxBehavior.showDispatchNote && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--info)', background: 'var(--info-soft)', borderRadius: 'var(--r-pill)', padding: '4px 10px' }}>
              <i className="iconoir-clock" style={{ fontSize: 12 }} />
              Sobre pedido{dispatchEstimateLabel ? ` — envío estimado ${dispatchEstimateLabel}` : ''}
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

        {/* ── Confidence capsule beside the price (S1.4 + S2.1 · finding #7) ────
            Reuses the shared slim trust capsule so the buyer resolves trust the moment
            they see the cost — not buried in the methods grid below. S2.1 adds the
            `devoluciones` signal here (verificado · pago protegido · devoluciones), so the
            full TrustSignals block below drops its returns pill in the redesign layout
            (`returnsLabel={redesign ? null : …}`) — the signal moves UP, no duplicate
            (symmetric to how S1.4 lifted protección). Redesign-gated.
            DEFERRED (no live source — stated in PR): seller rating/reseñas, response time,
            and a track-record `ventas` count (the only source is legacy `marketplace_orders`
            via `lib/ucp/identity.ts`, which undercounts Medusa-order sellers). ──────────── */}
        {redesign && (
          <div style={{ marginBottom: 14 }}>
            <TrustSignals
              channel="marketplace"
              variant="slim"
              paymentMethods={[]}
              fulfillmentMethods={[]}
              processingLabel={null}
              returnsLabel={returnsLabel}
              verified={listing.shop?.verified}
              paymentProtected={sellerHasStripe || sellerHasMp}
            />
          </div>
        )}

        {/* ── Unclaimed notice (S5.4) — honest "aún no reclamada" lead for a
            gem-imported shop with no owner. Buy/Offer/Cart already suppressed via
            isShopClaimed (no gating change); SellerTrustCard below carries contact
            + the claim nudge. ──────────────────────────────────────────────────── */}
        {unclaimedLed && listing.shop?.slug && <UnclaimedNotice shopSlug={listing.shop.slug} />}

        {/* ── Service hero (S4.1) — schedule-led, with "Qué incluye" from the
            service attrs + description. Leads the page for service listings, so the
            generic specs table + description duplicates below are suppressed
            (`!serviceLed`) to avoid repeating the same content. ───────────────── */}
        {serviceLed && (
          <ServiceHero
            listingId={listing.id}
            isSignedIn={isSignedIn}
            bookingUrl={bookingUrl}
            bookingText={bookingText}
            inclusions={listingSpecs(listing)}
            description={listing.description}
          />
        )}

        {/* ── Rental hero (S4.2) — date-range picker → exact total (días × precio +
            depósito). Leads for rental listings; the generic buy/offer bar is
            suppressed (`rentalLed` ⊂ suppressGenericBar). ──────────────────────── */}
        {rentalLed && (
          <RentalBooking
            listingId={listing.id}
            dailyRateCents={listing.price_cents!}
            depositCents={rentalDepositCents}
            period={rentalPeriod}
            currency={listing.currency}
            isSignedIn={isSignedIn}
            bookingUrl={bookingUrl}
            rentalPricingEnabled={rentalPricingEnabled}
            sellerHasPaymentMethod={hasAnyPayment}
          />
        )}

        {/* ── Digital hero (S4.3) — "entrega al instante" banner leads the page
            (file name + size + format), with specs reinterpreted as formato ·
            tamaño · (licencia/compatibilidad/incluye when stored). Replaces the
            lower generic digital badge for digitalLed. No envío/devoluciones/oferta. */}
        {digitalLed && (
          <div data-testid="pdp-digital-hero" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--agent-soft)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: digitalSpecRows.length ? 12 : 0 }}>
              <i className="iconoir-flash" style={{ fontSize: 22, color: 'var(--agent)', flexShrink: 0, marginTop: 1 }} />
              <div className="min-w-0">
                <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--agent)' }}>Entrega al instante</p>
                <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                  Recibes el archivo en cuanto se confirma el pago.
                </p>
                {digitalInfo?.name && (
                  <p style={{ fontSize: 12, color: 'var(--fg)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <i className="iconoir-page" style={{ fontSize: 12, marginRight: 4 }} />
                    {digitalInfo.name}
                    {digitalInfo.sizeLabel && <span style={{ color: 'var(--fg-muted)' }}> · {digitalInfo.sizeLabel}</span>}
                  </p>
                )}
              </div>
            </div>
            {digitalSpecRows.length > 0 && (
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', background: 'var(--bg-sunk)', borderRadius: 'var(--r-lg)', padding: 16 }}>
                {digitalSpecRows.map(spec => (
                  <div key={spec.label} style={{ display: 'contents' }}>
                    <dt style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{spec.label}</dt>
                    <dd style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{spec.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {/* ── Excerpt "Lee un adelanto" (S2.1) — inline free text sample for a
            digital listing, right below the digital hero. Channel-agnostic. ──── */}
        {excerpt && <ExcerptPanel text={excerpt.text} />}

        {/* ── Autos hero (S5.1) — REPUVE verification anchor + vehicle specs lead
            the page, with a primary "Agendar prueba de manejo". Owns the autos
            specs, so the lower REPUVE badge + generic specs table below are
            suppressed for `autoLed` (no duplicate). The buy/offer bar stays. ──── */}
        {autoLed && (
          <AutoHero
            listingId={listing.id}
            isSignedIn={isSignedIn}
            bookingUrl={bookingUrl}
            repuve={repuve}
            specs={listingSpecs(listing)}
            priceCents={listing.price_cents}
            attrs={listing.attrs ?? (listing.metadata?.attrs as Record<string, unknown> | undefined) ?? {}}
          />
        )}

        {/* ── Inmuebles hero (S5.2) — icon spec row + approximate-zone map +
            primary "Agendar visita". Additive summary; the full property specs
            table stays below (not suppressed). ──────────────────────────────── */}
        {inmuebleLed && (
          <InmuebleHero
            listingId={listing.id}
            isSignedIn={isSignedIn}
            bookingUrl={bookingUrl}
            attrs={(listing.attrs ?? listing.metadata?.attrs) as Record<string, unknown> | undefined}
            location={listing.location}
          />
        )}

        {/* ── Event hero (S5.3) — fecha · hora · lugar · dirección lead the page;
            the buy CTA below is relabeled "Comprar boleto"; a light "Ver mi
            boleto" link points at the order surface that renders the QR. The
            lower event block is suppressed for `eventLed` (no duplicate). ─────── */}
        {eventLed && eventDetails && <EventHero eventDetails={eventDetails} />}

        {/* ── Reorder by intent (S1.2): on MOBILE the specs slot + description sit
            ABOVE the payment/methods box and seller card (identify → trust → cost →
            act). Duplicate-render idiom — these are `md:hidden`; the full desktop
            description keeps its original lower position (`hidden md:block` below).
            Specs slot is an empty anchor for Sprint 3's scannable specs table.
            Suppressed for `autoLed` — AutoHero already shows the vehicle specs. ─── */}
        {redesign && !serviceLed && !autoLed && (
          <div className="md:hidden" data-testid="pdp-specs-slot">
            <SpecsTable rows={listingSpecs(listing)} />
          </div>
        )}
        {redesign && !serviceLed && listing.description && (
          <div className="md:hidden" data-testid="pdp-description-mobile" style={{ marginBottom: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Descripción</h2>
            <CollapsibleDescription text={listing.description} />
          </div>
        )}

        {/* ── Trust signals (S2 · C.4) ─────────────────────────────────────────
            Order-info pills + payment/fulfillment methods, extracted to the shared
            channel-aware <TrustSignals>. Marketplace renders byte-for-byte as before
            (parity-first). The mobile <SellerTrustCard> (S3.2) rides the `interstitial`
            slot so its position between pills and methods box is preserved. Epic D wires
            this same component into ChannelLayout / embed.
            S2.1: `returnsLabel={redesign ? null : returnsLabel}` — in the redesign layout
            returns lives in the confidence capsule above (no duplicate); the legacy path
            keeps the pill here so flipping `pdp_redesign` off renders unchanged. ───────── */}
        <TrustSignals
          channel="marketplace"
          variant="full"
          paymentMethods={paymentMethods}
          fulfillmentMethods={fulfillmentMethods}
          processingLabel={processingLabel}
          returnsLabel={redesign ? null : returnsLabel}
          interstitial={sellerTrustCard ? <div className="md:hidden">{sellerTrustCard}</div> : null}
          consultCta={!hasBuyablePrice && isClaimed ? (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: paymentMethods.length || fulfillmentMethods.length ? 12 : 0 }}>
                <i className="iconoir-message-text" style={{ fontSize: 18, color: 'var(--accent)', marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>Precio a consultar</p>
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                    {hasDirectContact ? 'Usa las opciones de contacto de la tienda para confirmar precio, pago y entrega.' : 'La tienda no publicó un precio para compra en línea.'}
                  </p>
                </div>
              </div>
              <div style={{ marginBottom: paymentMethods.length || fulfillmentMethods.length ? 12 : 0 }}>
                <AskSellerButton listingId={listing.id} isSignedIn={isSignedIn} />
              </div>
            </>
          ) : null}
        />

        {/* ── Badges ──────────────────────────────────────────────────────────── */}
        {/* digitalLed promotes this to the hero banner above, so it renders here
            only on the legacy (kill-switch off) path. */}
        {isDigital && digitalFile && !digitalLed && (
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

        {showRepuve && !autoLed && (
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

        {eventDetails && !eventLed && (
          <div data-testid="listing-event-details" style={{ background: 'var(--info-soft)', border: '1px solid var(--info)', borderRadius: 'var(--r-lg)', padding: '14px', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <i className="iconoir-calendar" style={{ fontSize: 20, color: 'var(--info)', marginTop: 1, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--info)', marginBottom: 6 }}>Evento</p>
                {eventDetails.formatted_date && (
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>
                    {eventDetails.formatted_date}
                    {eventDetails.formatted_time && <span> · {eventDetails.formatted_time}</span>}
                  </p>
                )}
                {eventDetails.venue_name && (
                  <p style={{ fontSize: 13, color: 'var(--fg)', marginTop: 4 }}>{eventDetails.venue_name}</p>
                )}
                {eventDetails.venue_address && (
                  <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{eventDetails.venue_address}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Desktop inline CTAs (buy now + make offer) ─────────────────────── */}
        {showBuyButtons && !suppressGenericBar && (
          <div className="hidden md:block" style={{ marginBottom: 20, padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
            {redesign ? redesignBarContent : ctaButtons}
          </div>
        )}

        {/* ── Sold-out notice (replaces buy CTAs) ─────────────────────────────── */}
        {buyBoxBehavior.showAgotado && showBuyerActions && !isDigital && !isSubscription && hasBuyablePrice && (
          <div style={{ marginBottom: 20, padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
            <i className="iconoir-xmark" style={{ fontSize: 22, color: 'var(--danger)' }} />
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
              redesign={redesign}
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
            <BuyButton listingId={listing.id} price={formatPrice(listing)} isDigital sellerHasStripe={sellerHasStripe} isSignedIn={isSignedIn} customDomain={customDomain} />
          </div>
        )}

        {/* ── Seller trust card — DESKTOP position (S3.2) ──────────────────────
            Original in-flow slot below the methods box. On mobile the same card
            renders higher (md:hidden above); here it's desktop-only. ─────────── */}
        {sellerTrustCard && <div className="hidden md:block">{sellerTrustCard}</div>}

        {bundleItems.length > 1 && listing.shop && !suppressGenericBar && (
          <SellerBundleSection sellerName={listing.shop.name} items={bundleItems} bundleTiers={shopBundleTiers} />
        )}

        {/* ── Especificaciones (S3.3 · finding #7) ────────────────────────────────
            Desktop copy of the scannable specs table (mobile copy rides the specs
            slot higher up). Redesign-gated so the kill-switch reverts cleanly; the
            table renders nothing when the listing has no structured attributes.
            Suppressed for serviceLed — its specs live in ServiceHero's "Qué incluye".
            Suppressed for autoLed — its specs live in the AutoHero block above. */}
        {redesign && !serviceLed && !autoLed && (
          <div className="hidden md:block">
            <SpecsTable rows={listingSpecs(listing)} />
          </div>
        )}

        {/* ── Description ──────────────────────────────────────────────────────── */}
        {/* Redesign (S1.2): this original lower copy becomes DESKTOP-only — mobile
            shows the collapsible description higher up (above payment/seller). When
            the kill-switch is off it renders for all viewports, exactly as before.
            Suppressed for serviceLed — the description is shown in ServiceHero's
            "Qué incluye" block instead. */}
        {listing.description && !serviceLed && (
          <div className={redesign ? 'hidden md:block' : undefined} style={{ marginBottom: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Descripción</h2>
            <p style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{listing.description}</p>
          </div>
        )}

        {/* Digital goods have no returns surface (S4.3 — no envío/devoluciones). */}
        {returnsLabel && !digitalLed && (
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
          their CTAs inline because they have extra context (tiers, file info).
          Redesign (S1.1): StickyBuyBar measures the bar's real height and reserves a
          matching in-flow spacer, so the variable-height bar never clips content.
          `barMode !== 'hidden'` is equivalent to `showBuyButtons` (see derivePdpBarMode). */}
      {redesign ? (
        barMode !== 'hidden' && !suppressGenericBar && <StickyBuyBar>{redesignBarContent}</StickyBuyBar>
      ) : (
        showBuyButtons && (
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
        )
      )}
    </div>
    </div>
  )
}
