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
  expires_hours: number            // how long seller has to respond (72h default)
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
  location: string | null
  state: string | null
  views: number
  created_at: string

  // Commerce capabilities
  shop: UcpShop
  actions: UcpActions
  payment_methods: UcpPaymentMethods
  checkout_urls: UcpCheckoutUrls
  offer_constraints: UcpOfferConstraints | null

  // Trust + safety signals (key differentiator vs. Craigslist/FB Marketplace)
  trust: UcpTrust

  // Domain-specific metadata (cars → brand/year/km, real estate → rooms/surface, etc.)
  metadata: Record<string, unknown>

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

  // ── Actions ─────────────────────────────────────────────────────────────────
  const hasPrice = listing.price_cents != null && listing.price_cents > 0
  const isDigital = listing.listing_type === 'digital'
  const isClaimed = !!(shop?.clerk_user_id && !shop.clerk_user_id.startsWith('pending:'))

  const buyNow = hasPrice && isClaimed && (hasMp || hasStripe)
  const makeOffer = hasPrice && !isDigital && isClaimed

  // ── Trust ───────────────────────────────────────────────────────────────────
  const listingMeta = listing.metadata ?? {}
  const repuveChecked = !!(listingMeta.repuve)
  const identityRequired = escrowMode === 'required'

  // ── Offer constraints ───────────────────────────────────────────────────────
  const offerConstraints: UcpOfferConstraints | null = makeOffer
    ? { min_offer_cents: null, expires_hours: 72 }
    : null

  // ── Checkout URLs (POST endpoints — agent sends listingId) ──────────────────
  const checkoutUrls: UcpCheckoutUrls = {}
  if (hasMp && hasPrice && !isDigital && isClaimed) checkoutUrls.mercadopago = `${baseUrl}/api/mp/checkout`
  if (hasStripe && hasPrice && isClaimed) checkoutUrls.stripe = `${baseUrl}/api/stripe/checkout`

  // ── Schema.org ──────────────────────────────────────────────────────────────
  const schemaOrg: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': listing.listing_type === 'service' ? 'Service' : 'Product',
    name: listing.title,
    description: listing.description,
    url: `${baseUrl}/l/${listing.id}`,
    image: listing.images?.[0]?.url,
    offers: hasPrice ? {
      '@type': 'Offer',
      price: (listing.price_cents! / 100).toFixed(2),
      priceCurrency: listing.currency ?? 'MXN',
      availability: 'https://schema.org/InStock',
      seller: shop ? { '@type': 'Organization', name: shop.name } : undefined,
    } : undefined,
    itemCondition: listing.condition ? `https://schema.org/${
      listing.condition === 'new' ? 'NewCondition'
      : listing.condition === 'like_new' ? 'LikeNewCondition'
      : 'UsedCondition'
    }` : undefined,
  }

  return {
    id: listing.id,
    url: `${baseUrl}/l/${listing.id}`,
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
    location: listing.location,
    state: listing.state,
    views: listing.views ?? 0,
    created_at: listing.created_at,

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

    metadata: listingMeta,
    schema_org: schemaOrg,
  }
}
