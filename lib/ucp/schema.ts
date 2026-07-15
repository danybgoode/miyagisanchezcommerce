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
import { financingDisplay, warrantyDisplay, inspectionDisplay } from '@/lib/auto-financing'
import { shortCollectionSlug } from '@/lib/collection-derive'
import { hasExcerpt } from '@/lib/excerpt'
import type { PriceGrid } from '@/lib/price-grid'
import { deriveInventoryMode } from '@/lib/inventory-mode'

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
  /** Shop's Acerca (about) body (own-shop-premium-presentation S3). Null when unauthored. */
  about: string | null
  /** Devoluciones policy, merchandised here so an agent can ground a policy question. Null when unset. */
  returns_policy: {
    window: string
    conditions?: string
    shipping_paid_by?: 'buyer' | 'seller'
    custom_note?: string | null
  } | null
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
  /** True when a digital listing carries a free "Lee un adelanto" text excerpt an
   *  agent can surface before buying/voting (bookshop launchpad S2.1). */
  has_excerpt: boolean
  location: string | null
  state: string | null
  views: number
  created_at: string

  // Stock — true unless a Medusa-managed item has sold out (null = unlimited)
  in_stock: boolean
  available_quantity: number | null
  /**
   * Inventory mode (catalog-management epic, Sprint 2 · Story 2.1) — an agent
   * reads 'backorder' the same honest signal a human buyer sees on the PDP
   * ("sobre pedido"), rather than a plain in_stock:false.
   */
  inventory_mode: 'tracked' | 'unlimited' | 'backorder'

  // Event admission metadata, present when the listing carries event attrs.
  event: ListingEventDetails | null

  // Rental pricing semantics (S4.2) — present for rental listings so an agent
  // reads `price` as the rate PER this period (plus a refundable deposit), rather
  // than quoting the per-period rate as the full price. null for non-rentals.
  rental: { rate_period: RatePeriod; deposit_cents: number } | null

  // Autos financing/trust surfaces (cars-vertical S2.3) — the same $/mes
  // hint + disclaimer, warranty, and inspection-report link AutoHero renders
  // on the PDP, so an agent reads the identical trust signals a buyer sees.
  // null for non-autos listings; each sub-field independently null when the
  // seller hasn't set it (mirrors `rental`'s presence pattern).
  auto_trust: {
    monthly_payment: { amount_cents: number; formatted: string; disclaimer: string } | null
    warranty: { text: string | null; months: number | null } | null
    inspection_report_url: string | null
  } | null

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

  // Configurator options + quantity-tiered pricing (custom-print-products S4 ·
  // 4.2). Null for an ordinary single-variant/flat-price listing — an agent
  // must resolve a variant_id + quantity from here before checkout when
  // present. The actual charged price always comes from Medusa's own cart
  // resolution at checkout (see lib/price-grid.ts); this is READ/discovery
  // only.
  price_grid: PriceGrid | null

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

/**
 * Derive the UCP shop payload's `about`/`returns_policy` fields from
 * `shop.metadata.settings` (own-shop-premium-presentation S3) — grounds "who
 * is this shop" / "what's their return policy" for an agent, straight off
 * every listing response. `returns_policy` merchandises the EXISTING
 * Devoluciones setting, never a separate value.
 */
function deriveUcpShopExtras(shop: Shop): Pick<UcpShop, 'about' | 'returns_policy'> {
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const about = (settings.about as { body?: string } | null | undefined)?.body?.trim() || null
  const rp = settings.returns_policy as
    | { window?: string; conditions?: string; shipping_paid_by?: 'buyer' | 'seller'; custom_note?: string | null }
    | null
    | undefined
  const returns_policy = rp?.window
    ? { window: rp.window, conditions: rp.conditions, shipping_paid_by: rp.shipping_paid_by, custom_note: rp.custom_note ?? null }
    : null
  return { about, returns_policy }
}

// ── Main transformer ───────────────────────────────────────────────────────────

export function toUcpListing(
  listing: Listing,
  baseUrl = 'https://miyagisanchez.com',
  priceGrid: PriceGrid | null = null,
  // Fail-closed default (matches DEFAULT_FLAGS['catalog.inventory_channels_enabled'])
  // for any caller that hasn't been threaded to pass the real flag value yet.
  inventoryChannelsEnabled = false,
): UcpListing {
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
  // Sold out only when Medusa Inventory tracks the item and stock hit 0 — a
  // backorder ("sobre pedido") listing never blocks (mirrors the PDP's
  // deriveBuyBoxBehavior). Flag-gated the same way as the PDP: OFF forces
  // allow_backorder false, so this reduces to today's exact behavior.
  const inventoryMode = deriveInventoryMode({
    manage_inventory: !!listing.manage_inventory,
    allow_backorder: inventoryChannelsEnabled ? !!listing.allow_backorder : false,
  })
  const inStock = inventoryMode === 'backorder' ? true : listing.in_stock !== false

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

  // Autos financing/trust surfaces (cars-vertical S2.3) — same attrs bag,
  // same pure projections AutoHero.tsx and the /l card chip use.
  const autosAttrs = (listingMeta.attrs ?? {}) as Record<string, unknown>
  const financing = listing.category === 'autos'
    ? financingDisplay({ priceCents: listing.price_cents, downPaymentPct: autosAttrs.financing_down_payment_pct, months: autosAttrs.financing_months })
    : null
  const warranty = listing.category === 'autos'
    ? warrantyDisplay({ text: autosAttrs.warranty_text, months: autosAttrs.warranty_months })
    : null
  const inspection = listing.category === 'autos'
    ? inspectionDisplay({ url: autosAttrs.inspection_report_url })
    : null
  const autoTrust = listing.category === 'autos' ? {
    monthly_payment: financing ? { amount_cents: financing.monthlyCents, formatted: financing.monthlyLabel, disclaimer: financing.disclaimer } : null,
    warranty: warranty ? { text: warranty.text, months: warranty.months } : null,
    inspection_report_url: inspection?.url ?? null,
  } : null

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
      availability: inventoryMode === 'backorder'
        ? 'https://schema.org/BackOrder'
        : inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
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
    has_excerpt: hasExcerpt(listingMeta),
    location: listing.location,
    state: listing.state,
    views: listing.views ?? 0,
    created_at: listing.created_at,

    in_stock: inStock,
    available_quantity: listing.available_quantity ?? null,
    inventory_mode: inventoryMode,
    event,
    rental,
    auto_trust: autoTrust,

    shop: shop ? {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      verified: shop.verified ?? false,
      location: shop.location,
      url: `${baseUrl}/s/${shop.slug}`,
      ...deriveUcpShopExtras(shop),
    } : {
      id: listing.shop_id,
      name: 'Unknown',
      // NEVER emit '' here: an empty slug lets any consumer's naive URL builder
      // (`${ORIGIN}/embed/s/${slug}`, our own EmbedSnippetSection included)
      // collapse to a bare `/embed/s/` — which Next's OWN trailing-slash
      // canonicalization 308-redirects BEFORE middleware ever runs, so a
      // middleware-level guard structurally cannot catch this shape (confirmed
      // live, 2026-07-15: middleware correctly 404s `/embed/s` but never even
      // sees `/embed/s/`). A guaranteed-non-empty, honestly-fake slug instead
      // 404s through the already-correct unknown-slug path (CSP header intact).
      slug: `unresolved-${publicListingId}`,
      verified: false,
      location: null,
      url: baseUrl,
      about: null,
      returns_policy: null,
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
    price_grid: priceGrid,
    schema_org: schemaOrg,
  }
}
