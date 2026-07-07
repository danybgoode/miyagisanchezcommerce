/**
 * UCP (Universal Commerce Protocol) — shared types and response builder.
 *
 * Every AI agent use case in ucp-use-cases.json maps to fields here:
 *  - P2P discovery      → catalog search + actions.make_offer
 *  - Embedded checkout  → actions.buy_now + checkout_urls
 *  - Escrow/trust       → trust.escrow_mode + trust signals
 *  - REPUVE (cars)      → trust.repuve_checked + metadata.repuve
 *  - A2A negotiation    → actions.make_offer + offer_constraints
 *  - Identity/pre-qual  → trust.verified_seller + identity_required
 */

import type { Listing, Shop } from '@/lib/types'
import { isShopClaimed } from '@/lib/claim'
import { getCustomFields, type CustomFieldDef } from '@/lib/personalization'
import { readEventDetails, type ListingEventDetails } from '@/lib/event-listing'
import { listingSpecs, type Spec } from '@/lib/listing-attributes'
import { toRatePeriod, type RatePeriod } from '@/lib/rental-pricing'
import { shortCollectionSlug } from '@/lib/collection-derive'

// ── Core types ─────────────────────────────────────────────────────────────────

export interface UcpPrice {
  amount_cents: number
  currency: string
  formatted: string
}

export interface UcpShop {
  id: string
  name: string
  slug: string
  verified: boolean
  location: string | null
  url: string
}

export interface UcpActions {
  buy_now: boolean         // has price + at least one payment method
  make_offer: boolean      // accepts negotiation (non-digital product)
  escrow_available: boolean
  escrow_required: boolean
}

export interface UcpPaymentMethods {
  mercadopago: boolean     // cards, OXXO, wallet, meses sin intereses
  stripe: boolean          // international cards
}

export interface UcpCheckoutUrls {
  mercadopago?: string     // /api/mp/checkout (POST)
  stripe?: string          // /api/stripe/checkout (POST)
}

export interface UcpOfferConstraints {
  min_offer_cents: number | null   // null = no floor enforced
  expires_hours: number            // how long seller has to respond (48h default)
}

export interface UcpTrust {
  verified_seller: boolean
  escrow_mode: 'off' | 'optional' | 'required'
  repuve_checked: boolean          // vehicle history verified
  identity_required: boolean       // listing requires buyer identity verification
}

export interface UcpListing {
  // Core identity
  id: string
  url: string
  title: string
  description: string | null
  price: UcpPrice | null
  images: Array<{ url: string; alt: string }>
  condition: string | null
  listing_type: string
  category: string | null
  /** Seller-defined collection short slugs this listing belongs to (own-shop-premium-presentation S2). */
  collections: string[]
  location: string | null
  state: string | null
  views: number
  created_at: string

  // Stock — true unless a Medusa-managed item has sold out (null = unlimited)
  in_stock: boolean
  available_quantity: number | null

  // Event admission metadata, present when the listing carries event attrs.
  event: ListingEventDetails | null

  // Rental pricing semantics (S4.2) — present for rental listings so an agent
  // reads `price` as the rate PER this period (plus a refundable deposit), rather
  // than quoting the per-period rate as the full price. null for non-rentals.
  rental: { rate_period: RatePeriod; deposit_cents: number } | null

  // Commerce capabilities
  shop: UcpShop
  actions: UcpActions
  payment_methods: UcpPaymentMethods
  checkout_urls: UcpCheckoutUrls
  offer_constraints: UcpOfferConstraints | null

  // Trust + safety signals (key differentiator vs. Craigslist/FB Marketplace)
  trust: UcpTrust

  // Labeled, scannable per-category specs (talla, material, año, km…), derived
  // from the category attribute schema. Empty when the listing carries none.
  specs: Spec[]

  // Domain-specific metadata (cars → brand/year/km, real estate → rooms/surface, etc.)
  metadata: Record<string, unknown>

  // Buyer personalization the seller requires/offers (engraving text, options…).
  // An agent must collect these and submit them on the checkout session.
  personalization_fields: CustomFieldDef[]

  // Schema.org for LLM structured understanding
  schema_org: Record<string, unknown>
}

export interface UcpCatalogResponse {
  items: UcpListing[]
  total: number
  limit: number
  cursor: string | null         // ISO timestamp of last item — pass as ?cursor= for next page
  _meta: {
    api: string
    version: string
    docs: string
  }
}

export interface UcpManifest {
  name: string
  description: string
  version: string
  base_url: string
  capabilities: string[]
  endpoints: Record<string, { method: string; description: string; auth: string }>
  mcp_endpoint: string
  schema_org_context: string
}

// ── Formatter helpers ──────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' })
    .format(cents / 100)
}

// ── Main transformer ───────────────────────────────────────────────────────────

export function toUcpListing(listing: Listing, baseUrl = 'https://miyagisanchez.com'): UcpListing {
  const shop = listing.shop
  const publicListingId = listing.medusa_product_id ?? listing.id

  // ── Payment methods ─────────────────────────────────────────────────────────
  const shopMeta = (shop?.metadata ?? {}) as Record<string, unknown>
  const stripeSettings = (shopMeta.settings as Record<string, unknown> | undefined)?.stripe as
    { enabled?: boolean; charges_enabled?: boolean; account_id?: string } | undefined
  const hasMp = (shopMeta.mp_enabled as boolean | undefined) !== false
  const hasStripe = !!(stripeSettings?.enabled !== false && stripeSettings?.charges_enabled && stripeSettings.account_id)

  // ── Escrow ──────────────────────────────────────────────────────────────────
  const escrowMode = ((shopMeta.settings as Record<string, unknown> | undefined)
    ?.checkout as Record<string, unknown> | undefined)
    ?.escrow_mode as 'off' | 'optional' | 'required' | undefined ?? 'off'

  // ── Stock ─────────────────────────────────────────────────────────────────
  // Sold out only when Medusa Inventory tracks the item and stock hit 0.
  const inStock = listing.in_stock !== false

  // ── Actions ─────────────────────────────────────────────────────────────────
  const hasPrice = listing.price_cents != null && listing.price_cents > 0
  const isDigital = listing.listing_type === 'digital'
  const isClaimed = isShopClaimed(shop)

  const buyNow = hasPrice && isClaimed && inStock && (hasMp || hasStripe)
  const makeOffer = hasPrice && !isDigital && isClaimed && inStock

  // ── Trust ───────────────────────────────────────────────────────────────────
  const listingMeta = listing.metadata ?? {}
  const event = readEventDetails(listing)
  // Rental pricing semantics — rate period + refundable deposit (pesos → cents),
  // read from the same metadata.attrs the PDP date picker uses (S4.2).
  const rentalAttrs = (listingMeta.attrs ?? {}) as Record<string, unknown>
  const rental = listing.listing_type === 'rental' ? {
    rate_period: toRatePeriod(rentalAttrs.rate_period),
    deposit_cents: Math.max(0, Math.round((Number(rentalAttrs.deposit) || 0) * 100)),
  } : null
  const repuveChecked = !!(listingMeta.repuve)
  const identityRequired = escrowMode === 'required'

  // ── Offer constraints ───────────────────────────────────────────────────────
  const offerConstraints: UcpOfferConstraints | null = makeOffer
    ? { min_offer_cents: null, expires_hours: 48 }
    : null

  // ── Checkout URLs (POST endpoints — agent sends listingId) ──────────────────
  const checkoutUrls: UcpCheckoutUrls = {}
  if (hasMp && hasPrice && !isDigital && isClaimed && inStock) checkoutUrls.mercadopago = `${baseUrl}/api/mp/checkout`
  if (hasStripe && hasPrice && isClaimed && inStock) checkoutUrls.stripe = `${baseUrl}/api/stripe/checkout`

  // ── Schema.org ──────────────────────────────────────────────────────────────
  const schemaOrg: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': event ? 'Event' : listing.listing_type === 'service' ? 'Service' : 'Product',
    name: listing.title,
    description: listing.description,
    url: `${baseUrl}/l/${publicListingId}`,
    image: listing.images?.[0]?.url,
    startDate: event?.starts_at ?? undefined,
    location: event?.location_label ? {
      '@type': 'Place',
      name: event.venue_name ?? event.location_label,
      address: event.venue_address ?? undefined,
    } : undefined,
    offers: hasPrice ? {
      '@type': 'Offer',
      price: (listing.price_cents! / 100).toFixed(2),
      priceCurrency: listing.currency ?? 'MXN',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: shop ? { '@type': 'Organization', name: shop.name } : undefined,
    } : undefined,
    itemCondition: listing.condition ? `https://schema.org/${
      listing.condition === 'new' ? 'NewCondition'
      : listing.condition === 'like_new' ? 'LikeNewCondition'
      : 'UsedCondition'
    }` : undefined,
  }

  return {
    id: publicListingId,
    url: `${baseUrl}/l/${publicListingId}`,
    title: listing.title,
    description: listing.description,
    price: hasPrice ? {
      amount_cents: listing.price_cents!,
      currency: listing.currency ?? 'MXN',
      formatted: formatPrice(listing.price_cents!, listing.currency ?? 'MXN'),
    } : null,
    images: (listing.images ?? []).map(img => ({ url: img.url, alt: img.alt ?? listing.title })),
    condition: listing.condition,
    listing_type: listing.listing_type,
    category: listing.category,
    // Seller-defined collection short slugs (own-shop-premium-presentation
    // S2) — an agent can ground "which section is this in" and link to
    // `${shop.url}/c/${slug}`. Empty when the shop has no collections.
    collections: shop ? (listing.collections ?? []).map((h) => shortCollectionSlug(h, shop.slug)) : [],
    location: listing.location,
    state: listing.state,
    views: listing.views ?? 0,
    created_at: listing.created_at,

    in_stock: inStock,
    available_quantity: listing.available_quantity ?? null,
    event,
    rental,

    shop: shop ? {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      verified: shop.verified ?? false,
      location: shop.location,
      url: `${baseUrl}/s/${shop.slug}`,
    } : {
      id: listing.shop_id,
      name: 'Unknown',
      slug: '',
      verified: false,
      location: null,
      url: baseUrl,
    },

    actions: {
      buy_now: buyNow,
      make_offer: makeOffer,
      escrow_available: escrowMode === 'optional' || escrowMode === 'required',
      escrow_required: escrowMode === 'required',
    },

    payment_methods: {
      mercadopago: hasMp && isClaimed,
      stripe: hasStripe,
    },

    checkout_urls: checkoutUrls,
    offer_constraints: offerConstraints,

    trust: {
      verified_seller: shop?.verified ?? false,
      escrow_mode: escrowMode,
      repuve_checked: repuveChecked,
      identity_required: identityRequired,
    },

    specs: listingSpecs(listing),
    metadata: listingMeta,
    personalization_fields: getCustomFields(listingMeta),
    schema_org: schemaOrg,
  }
}
