/**
 * Miyagi Sánchez UCP MCP Server (Stateless HTTP / JSON-RPC 2.0)
 *
 * MCP over HTTP is plain JSON-RPC 2.0. This handler avoids the Node.js HTTP
 * transport layer and works natively with Next.js App Router.
 *
 * To connect from Claude Desktop, add to claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "miyagisanchez": {
 *       "type": "http",
 *       "url": "https://miyagisanchez.com/api/ucp/mcp"
 *     }
 *   }
 * }
 *
 * Tools:
 *   search_listings       Browse catalog with filters
 *   get_listing           Full detail for one listing
 *   get_checkout_options  All payment methods for a listing with pre-generated URLs
 *   create_checkout       Generate a single payment URL (MP or Stripe)
 *   make_offer            Submit price offer → returns offer_id
 *   get_shop              Seller profile + their listings
 */

import { NextRequest, NextResponse } from 'next/server'
import { toUcpListing } from '@/lib/ucp/schema'
import { isShopClaimed } from '@/lib/claim'
import { computeTrustScore } from '@/lib/ucp/identity'
import { getCalAvailableSlots, createCalBooking } from '@/lib/calcom'
import { ensureUrlProtocol } from '@/lib/url'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { revalidateTag } from 'next/cache'
import { resolveAgentShop } from '@/lib/agent-auth'
import { resolveDomainEntitlement } from '@/lib/domain-entitlement-server'
import { startCustomDomainCheckout } from '@/lib/domain-subscription-checkout'
import { CUSTOM_DOMAIN_PRICE_LABEL } from '@/lib/domain-pricing'
import { asDomainCadence } from '@/lib/domain-cadence'
import { CAMPAIGN_COUPON_CODE } from '@/lib/domain-coupon'
import { resolveSubdomainEntitlement } from '@/lib/subdomain-entitlement-server'
import { startSubdomainCheckout } from '@/lib/subdomain-subscription-checkout'
import { switchSubdomainCadence } from '@/lib/subdomain-switch'
import { coerceSubdomainInterval } from '@/lib/subdomain-billing'
import { SUBDOMAIN_PRICE_LABEL, SUBDOMAIN_PRICE_MONTHLY_LABEL } from '@/lib/subdomain-pricing'
import { buildStoreConfigSnapshot } from '@/lib/store-config'
import { applyStoreConfig } from '@/lib/apply-config-manifest'
import { recordAgentConfigChange, recordAgentOfferAction, recordAgentListingAction, recordAgentListingCreate } from '@/lib/agent-audit'
import { listShopOffers, respondToOffer } from '@/lib/offer-respond'
import { listShopOrdersViaInternal } from '@/lib/agent-orders'
import { listShopListings, shopOwnsProduct, patchSellerProductViaInternal, createSellerProductViaInternal, listingActivationBlock } from '@/lib/seller-products'
import { getShopCollections } from '@/lib/listings'
import { shortCollectionSlug } from '@/lib/collection-derive'
import { validateRows, CATALOG_CATEGORY_KEYS, IMPORT_LISTING_TYPES, IMPORT_CONDITIONS, IMPORT_CURRENCIES, type CatalogImportRow } from '@/lib/catalog-import'
import { ingestImageUrls } from '@/lib/image-ingest'
import { syncSupabaseListingMirror } from '@/lib/provisioning'
import { db } from '@/lib/supabase'
import { MANUAL_SECTIONS, type StoreConfigManifest } from '@/lib/settings-import'
import { getNeighborhoodPulseAgentView } from '@/lib/neighborhood-pulse-agent'
import { aboutMcpResource, RELAY_LANGUAGE_DIRECTIVE } from '@/lib/about-agent'
import { buildSetupSpec } from '@/lib/setup-spec'
import type { Listing } from '@/lib/types'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
const MEDUSA_HEADERS = { 'x-publishable-api-key': PUB_KEY }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id',
}

// ── JSON-RPC types ─────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function err(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_listings',
    description: 'Search the Miyagi Sánchez marketplace catalog. Returns listings with prices, trust signals, and checkout URLs. Use this to find products, services, cars, real estate, and more across Mexico.',
    inputSchema: {
      type: 'object',
      properties: {
        q:            { type: 'string', description: 'Search query in Spanish (e.g. "iPhone 14 pro" or "taller mecánico CDMX")' },
        category:     { type: 'string', enum: ['autos','inmuebles','electronica','hogar','moda','deportes','servicios','mascotas','herramientas','negocios','otros'], description: 'Product category' },
        listing_type: { type: 'string', enum: ['product','service','rental','digital'], description: 'Type of listing' },
        state:        { type: 'string', description: 'Mexican state e.g. "Ciudad de México", "Jalisco", "Nuevo León"' },
        location:     { type: 'string', description: 'City or neighborhood e.g. "Polanco", "Monterrey"' },
        condition:    { type: 'string', enum: ['new','like_new','good','fair','parts'], description: 'Item condition' },
        min_price:    { type: 'number', description: 'Minimum price in MXN pesos' },
        max_price:    { type: 'number', description: 'Maximum price in MXN pesos' },
        limit:        { type: 'number', minimum: 1, maximum: 20, default: 10, description: 'Number of results' },
        sort:         { type: 'string', enum: ['reciente','precio_asc','precio_desc','popular'], default: 'reciente', description: 'Sort order' },
        brand:        { type: 'string', description: 'Car brand (use with category=autos)' },
        year_from:    { type: 'number', description: 'Car year minimum (use with category=autos)' },
        year_to:      { type: 'number', description: 'Car year maximum (use with category=autos)' },
      },
    },
  },
  {
    name: 'get_neighborhood_pulse',
    description: 'Read the public neighborhood pulse: opted-in community items, trending listings, and merchants gaining local attention. Read-only; use it to understand local context before recommending what to buy.',
    inputSchema: {
      type: 'object',
      properties: {
        community_limit: { type: 'number', minimum: 1, maximum: 24, default: 12, description: 'Number of community items to return' },
        trending_limit: { type: 'number', minimum: 1, maximum: 20, default: 8, description: 'Number of trending listings to return' },
        shop_limit: { type: 'number', minimum: 1, maximum: 12, default: 6, description: 'Number of merchant spotlights to return' },
      },
    },
  },
  {
    name: 'get_listing',
    description: 'Get full details for a specific listing by ID, including trust signals, seller info, available payment methods, and checkout URLs.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Listing UUID from search_listings results' },
      },
    },
  },
  {
    name: 'get_checkout_options',
    description: 'Get ALL available payment methods for a listing in one call. Returns instant methods (MercadoPago, Stripe) with ready-to-use checkout URLs AND contact-first methods (bank transfer/SPEI with CLABE, cash on pickup, WhatsApp) with full instructions. Always call this before create_checkout so you can present the buyer their best options.',
    inputSchema: {
      type: 'object',
      required: ['listing_id'],
      properties: {
        listing_id:  { type: 'string', description: 'Listing UUID' },
        offer_id:    { type: 'string', description: 'Accepted offer UUID — session will use negotiated price' },
        buyer_email: { type: 'string', description: 'Buyer email (optional)' },
      },
    },
  },
  {
    name: 'create_checkout',
    description: 'Generate a payment checkout URL for a single specific instant payment method (MercadoPago or Stripe). Prefer get_checkout_options first to see all available methods including SPEI and cash options.',
    inputSchema: {
      type: 'object',
      required: ['listing_id'],
      properties: {
        listing_id:  { type: 'string', description: 'Listing UUID' },
        method:      { type: 'string', enum: ['mercadopago','stripe'], default: 'mercadopago', description: 'Payment method' },
        buyer_email: { type: 'string', description: 'Buyer email (optional, pre-fills checkout form)' },
        offer_id:    { type: 'string', description: 'Accepted offer UUID — uses negotiated price instead of list price' },
      },
    },
  },
  {
    name: 'get_support_options',
    description: 'Discover a seller support widget by publishable embed key. Returns public shop identity, preset support amounts, min/max custom amount, default visibility, and available hosted payment providers.',
    inputSchema: {
      type: 'object',
      required: ['embed_key'],
      properties: {
        embed_key: { type: 'string', description: 'Publishable support/embed key, shaped like emb_pk_...' },
      },
    },
  },
  {
    name: 'create_support_checkout',
    description: 'Initiate a guest support contribution checkout for a seller support widget. Uses the same validation and hosted Stripe/Mercado Pago handoff as <miyagi-support-widget>; no Miyagi account is required.',
    inputSchema: {
      type: 'object',
      required: ['embed_key', 'amount_cents', 'supporter_email'],
      properties: {
        embed_key: { type: 'string', description: 'Publishable support/embed key, shaped like emb_pk_...' },
        amount_cents: { type: 'number', description: 'Contribution amount in centavos (e.g. 10000 = $100 MXN)' },
        provider: { type: 'string', enum: ['mercadopago', 'stripe'], default: 'mercadopago' },
        supporter_email: { type: 'string', description: 'Email for receipt' },
        supporter_name: { type: 'string', description: 'Optional display name' },
        message: { type: 'string', description: 'Optional message, max 250 characters' },
        visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
      },
    },
  },
  {
    name: 'make_offer',
    description: "Submit a price offer on a listing. Requires an authenticated Miyagi buyer session. The seller is notified and has 48 hours to accept, counter, or decline. If accepted, use create_checkout with the returned offer_id to buy at the negotiated price.",
    inputSchema: {
      type: 'object',
      required: ['listing_id', 'offer_amount', 'buyer_name', 'buyer_email'],
      properties: {
        listing_id:    { type: 'string', description: 'Listing UUID' },
        offer_amount:  { type: 'number', description: 'Your offer in MXN pesos (e.g. 1500 = $1,500)' },
        buyer_name:    { type: 'string', description: 'Your name' },
        buyer_email:   { type: 'string', description: 'Buyer email for account matching and receipts; do not expose it as seller contact info' },
        message:       { type: 'string', description: 'Optional message to the seller' },
      },
    },
  },
  {
    name: 'get_shop',
    description: "Get a seller's shop profile and their active listings. Use to check a seller's trust level, location, and what else they're selling.",
    inputSchema: {
      type: 'object',
      required: ['shop_slug'],
      properties: {
        shop_slug: { type: 'string', description: 'Shop slug from listing.shop.slug in search results' },
        limit:     { type: 'number', minimum: 1, maximum: 20, default: 10, description: 'Number of listings to return' },
      },
    },
  },
  {
    name: 'check_availability',
    description: "Check available appointment slots for a listing. Returns the next available days and time slots from the seller's Cal.com calendar. Use before book_appointment to show the buyer what times are available.",
    inputSchema: {
      type: 'object',
      required: ['listing_id'],
      properties: {
        listing_id: { type: 'string', description: 'Listing UUID' },
        date_from:  { type: 'string', description: 'Start date to check (YYYY-MM-DD). Defaults to today.' },
        date_to:    { type: 'string', description: 'End date to check (YYYY-MM-DD). Defaults to 7 days from today.' },
        timezone:   { type: 'string', description: 'IANA timezone. Defaults to America/Mexico_City.' },
      },
    },
  },
  {
    name: 'book_appointment',
    description: 'Book an appointment slot for a listing — schedules a visit, test drive, or meeting with the seller. Returns booking confirmation with a unique ID.',
    inputSchema: {
      type: 'object',
      required: ['listing_id', 'start_time', 'buyer_name', 'buyer_email'],
      properties: {
        listing_id:  { type: 'string', description: 'Listing UUID' },
        start_time:  { type: 'string', description: 'ISO 8601 datetime of the desired slot (from check_availability)' },
        buyer_name:  { type: 'string', description: 'Full name of the person booking' },
        buyer_email: { type: 'string', description: 'Email to send booking confirmation to' },
        notes:       { type: 'string', description: 'Optional notes for the seller (e.g., "Interested in test driving")' },
        timezone:    { type: 'string', description: 'IANA timezone. Defaults to America/Mexico_City.' },
      },
    },
  },
  {
    name: 'get_buyer_trust',
    description: 'Check the OmniReputation trust score for a buyer by email address or Clerk user ID. Returns a 0–100 score, trust level (unverified/basic/trusted/verified/elite), and the individual signals that make up the score. Use before making a transaction recommendation to assess buyer trustworthiness.',
    inputSchema: {
      type: 'object',
      required: ['identifier'],
      properties: {
        identifier: { type: 'string', description: 'Email address (e.g. "juan@example.com") or Clerk user ID (e.g. "user_abc123")' },
      },
    },
  },
  {
    name: 'get_store_configuration',
    description: "SELLER TOOL. Read YOUR OWN shop's declarative configuration — profile/brand, shipping, negotiation, notifications, order handling, returns policy, and scheduling links. Requires a seller agent token (Authorization: Bearer ms_agent_…) generated in the shop's “Agentes e integraciones” settings; it is scoped to that one shop. Never returns secrets (no payment keys, bank CLABE, Stripe/MercadoPago tokens, or Cal.com keys). Call this before patch_store_configuration to see current values and which sections still need a manual step.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'patch_store_configuration',
    description: "SELLER TOOL. Update YOUR OWN shop's configuration. Requires the seller agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Send only the blocks you want to change inside `configuration` — untouched blocks are preserved (partial patch). Every value is strictly re-validated server-side before anything is written; invalid fields are dropped and reported, and a malformed block can never break the live storefront. Payments, custom domain, and Cal.com are OAuth-bound and are ignored here — they always need a manual step. Returns a per-block report of what was applied vs. skipped.",
    inputSchema: {
      type: 'object',
      required: ['configuration'],
      properties: {
        configuration: {
          type: 'object',
          description: 'Partial store config. Include only the blocks to change. Mirrors the shape returned by get_store_configuration.',
          properties: {
            profile:        { type: 'object', description: 'name, description, state, city, tagline, accent_color (#rrggbb), logo_url, banner_url (absolute http/https URLs — ingested to our storage), social {instagram,facebook,whatsapp,tiktok,twitter}' },
            shipping:       { type: 'object', description: 'local_pickup, envia_enabled, allowed_carriers[], rate_display (recommended|cheapest|all), handling_fee_cents, package_defaults, origin_address, pickup_spots[]' },
            offers:         { type: 'object', description: 'min_buyer_trust_level, negotiation {enabled, auto_accept_pct, auto_decline_pct, auto_counter_pct} (percentages 0–100)' },
            notifications:  { type: 'object', description: 'email_new_view, email_new_message (booleans)' },
            orders:         { type: 'object', description: 'processing_time, auto_accept, dispatch_window_days, auto_confirm_days' },
            returns_policy: { type: 'object', description: 'window, conditions, shipping_paid_by (buyer|seller), custom_note' },
            scheduling:     { type: 'object', description: 'links: [{label, url}] — booking links (Cal.com connection is separate/manual)' },
          },
        },
      },
    },
  },
  {
    name: 'list_offers',
    description: "SELLER TOOL. List the open price offers on YOUR OWN shop's listings so you can decide how to respond. Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Returns each offer's amount, % of asking price, a quality read, the buyer name + message, status, time left, and listing — no secrets. Use before respond_to_offer.",
    inputSchema: {
      type: 'object',
      properties: {
        pending_only: { type: 'boolean', description: 'If true, return only offers awaiting your response (status "pending"). Default false (all non-terminal offers).' },
      },
    },
  },
  {
    name: 'respond_to_offer',
    description: "SELLER TOOL. Respond to a buyer's price offer on YOUR OWN listing: accept, counter, or decline. Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. ACCEPTING commits a sale at the offered price and sends the buyer a checkout link — same effect as accepting in the portal. A counter must be ABOVE the buyer's offer and BELOW the list price. Get offer_id from list_offers.",
    inputSchema: {
      type: 'object',
      required: ['offer_id', 'action'],
      properties: {
        offer_id:            { type: 'string', description: 'Offer UUID from list_offers' },
        action:              { type: 'string', enum: ['accept', 'counter', 'decline'], description: 'accept (commits a sale at the offer price), counter, or decline' },
        counter_amount_mxn:  { type: 'number', description: 'Required for action=counter. Counter price in MXN pesos (must be > the buyer offer and < the list price).' },
        counter_message:     { type: 'string', description: 'Optional message to the buyer with a counter.' },
      },
    },
  },
  {
    name: 'create_listing',
    description: "SELLER TOOL. Create a brand-new listing in YOUR OWN shop. Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Price is in MXN pesos (price_mxn, not centavos). Image URLs are fetched into our storage. A physical `product` whose shop hasn't configured both a delivery method AND a payment method is saved as a draft (paused) with an explanation — it won't go live until the shop is sale-ready. Returns the new product_id (use it with update_listing / set_listing_status).",
    inputSchema: {
      type: 'object',
      required: ['title', 'category'],
      properties: {
        title:        { type: 'string', description: '5–100 characters.' },
        category:     { type: 'string', description: `One of: ${CATALOG_CATEGORY_KEYS.join(', ')}.` },
        description:  { type: 'string', description: 'Improves quality + SEO.' },
        price_mxn:    { type: 'number', description: 'Price in MXN pesos (1500 = $1,500). Omit for "a convenir".' },
        currency:     { type: 'string', enum: [...IMPORT_CURRENCIES], description: 'Default MXN.' },
        listing_type: { type: 'string', enum: [...IMPORT_LISTING_TYPES], description: 'Default product.' },
        condition:    { type: 'string', enum: [...IMPORT_CONDITIONS], description: 'Physical products only.' },
        quantity:     { type: 'number', description: 'Units available. Default 1 (physical products).' },
        state:        { type: 'string', description: 'Mexican state, e.g. "Jalisco".' },
        city:         { type: 'string', description: 'City / municipio / alcaldía.' },
        images:       { type: 'array', items: { type: 'string' }, description: 'Absolute image URLs (http/https). The first is the cover. Max 6.' },
        weight_grams: { type: 'number', description: 'Shipping weight in grams (improves shipping quotes).' },
      },
    },
  },
  {
    name: 'list_my_listings',
    description: "SELLER TOOL. List YOUR OWN shop's listings (all statuses, incl. paused) so you can manage them. Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Returns each listing's product_id, title, price, status, and type. Use product_id with update_listing / set_listing_status.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_my_collections',
    description: "SELLER TOOL. List YOUR OWN shop's collections (Die-cut, Zines…) so you can assign listings to them. Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Returns each collection's name and short slug — pass the name(s) to update_listing's collection_names to assign a listing.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_orders',
    description: "SELLER TOOL. List YOUR OWN shop's orders across every sales channel — native Miyagi sales and Mercado Libre sales materialized into Medusa (ml-orders-native) — with source/channel attribution and tags. Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Returns each order's id, status, buyer, amount, source (miyagi|mercadolibre), tags, and shipment/tracking.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by order status (e.g. "shipped", "delivered")' },
        source: { type: 'string', enum: ['miyagi', 'mercadolibre'], description: 'Filter by sales channel' },
        limit:  { type: 'number', minimum: 1, maximum: 50, description: 'Max orders to return (default 20)' },
      },
    },
  },
  {
    name: 'update_listing',
    description: "SELLER TOOL. Update one of YOUR OWN listings: title, description, price, stock quantity, and/or collection membership. Requires the shop agent token, scoped to one shop. Changing the price changes what buyers pay — it's audited and the seller is alerted. Get product_id from list_my_listings; get collection names from list_my_collections.",
    inputSchema: {
      type: 'object',
      required: ['product_id'],
      properties: {
        product_id:  { type: 'string', description: 'Product id from list_my_listings' },
        title:       { type: 'string', description: 'New title (max 100 chars)' },
        description: { type: 'string', description: 'New description' },
        price_mxn:   { type: 'number', description: 'New price in MXN pesos (e.g. 1500 = $1,500)' },
        quantity:    { type: 'number', description: 'New stock quantity (physical products only)' },
        collection_names: {
          type: 'array', items: { type: 'string' },
          description: 'Full replacement set of collection names (from list_my_collections) this listing should belong to. Omit to leave unchanged; pass [] to clear.',
        },
      },
    },
  },
  {
    name: 'set_listing_status',
    description: "SELLER TOOL. Activate (publish) or pause (unpublish) one of YOUR OWN listings. Requires the shop agent token, scoped to one shop. Activating a physical product is blocked unless the shop has a delivery method AND a payment method configured (same rule as the portal). Get product_id from list_my_listings.",
    inputSchema: {
      type: 'object',
      required: ['product_id', 'status'],
      properties: {
        product_id: { type: 'string', description: 'Product id from list_my_listings' },
        status:     { type: 'string', enum: ['active', 'paused'], description: 'active = publish, paused = unpublish' },
      },
    },
  },
  {
    name: 'get_domain_entitlement',
    description: "SELLER TOOL. Check whether YOUR OWN shop may connect a custom domain (the platform's paid SKU). Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Returns whether the shop is entitled and why (grandfathered / comp grant / one-time grant / active subscription / not entitled), the annual price, and — when not entitled — that the campaign coupon `miyagisan` covers the first year free. The SKU can be bought in two cadences (an annual subscription, or a one-time year up front with no recurring mandate). The subdomain and free shop URL are always free regardless. Use before start_domain_subscription.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'start_domain_subscription',
    description: "SELLER TOOL. Start the Stripe checkout for YOUR OWN shop's custom-domain SKU ($499 MXN/yr). Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Two cadences: `recurring` (default — an annual subscription that auto-renews) or `one_time` (pay one year up front with NO recurring mandate; entitlement is a dated 12-month grant that lapses gracefully at year end with no auto-charge — the cash-friendly option). On the `recurring` cadence you may pass a `coupon` (e.g. `miyagisan`) to comp the first year — capped at 100 redemptions; an exhausted/invalid coupon is refused with a clear message and no checkout is created. Returns a Stripe checkout URL the seller opens to pay (or, with a valid 100%-off coupon, to confirm at $0). Entitlement flips on automatically once checkout completes.",
    inputSchema: {
      type: 'object',
      properties: {
        cadence: { type: 'string', enum: ['recurring', 'one_time'], description: "Payment cadence: 'recurring' (annual subscription, default) or 'one_time' (pay a year up front, no renewal)" },
        coupon: { type: 'string', description: 'Optional campaign coupon code (e.g. miyagisan) to comp the first year — recurring cadence only' },
      },
    },
  },
  {
    name: 'get_subdomain_entitlement',
    description: "SELLER TOOL. Check whether YOUR OWN shop may serve its white-label subdomain <slug>.miyagisanchez.com (the platform's cheaper paid SKU, $199 MXN/yr). Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Returns whether the shop is entitled and why (grandfathered / comp grant / one-time grant / active subscription / not entitled) and the annual price. The free shop URL (/s/slug) is always free regardless. Use before start_subdomain_subscription.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'start_subdomain_subscription',
    description: "SELLER TOOL. Start the Stripe checkout for YOUR OWN shop's subdomain SKU ($199 MXN/yr, or $25 MXN/mo). Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Two cadences: `recurring` (default — a subscription that auto-renews) or `one_time` (pay one year up front with NO recurring mandate; entitlement is a dated 12-month grant that lapses gracefully at year end with no auto-charge — the cash-friendly option). On the `recurring` cadence pick the billing `interval`: `year` (default — $199/yr, the discounted option) or `month` ($25/mo, no annual commitment); `one_time` is always a year. No campaign coupon (that's the custom-domain SKU). Returns a Stripe checkout URL the seller opens to pay. Entitlement flips on automatically once checkout completes.",
    inputSchema: {
      type: 'object',
      properties: {
        cadence: { type: 'string', enum: ['recurring', 'one_time'], description: "Payment cadence: 'recurring' (subscription, default) or 'one_time' (pay a year up front, no renewal)" },
        interval: { type: 'string', enum: ['year', 'month'], description: "Recurring billing interval: 'year' ($199/yr, default) or 'month' ($25/mo). Applies to the 'recurring' cadence only." },
      },
    },
  },
  {
    name: 'switch_subdomain_cadence',
    description: "SELLER TOOL. Switch YOUR OWN shop's ACTIVE recurring subdomain subscription between monthly ($25/mo) and yearly ($199/yr). Requires the shop agent token (Authorization: Bearer ms_agent_…), scoped to one shop. Does a Stripe proration on the SAME subscription — no double charge and no gap in your subdomain (it keeps serving white-label throughout). Refused cleanly if you have no active subscription to switch, or if you're already on the target cadence (no-op). Use start_subdomain_subscription first if you don't have a subscription yet.",
    inputSchema: {
      type: 'object',
      properties: {
        interval: { type: 'string', enum: ['year', 'month'], description: "Target billing interval: 'year' ($199/yr) or 'month' ($25/mo)." },
      },
      required: ['interval'],
    },
  },
  {
    name: 'about_miyagi',
    description: `What miyagisanchez.com is and WHY/HOW to sell here — the supply-side story for a prospective seller (what Miyagi is, why sell, how to start, what it costs). Call this when a user asks about the marketplace itself or whether/how to sell on it. ${RELAY_LANGUAGE_DIRECTIVE}`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_setup_spec',
    description: "Onboarding 0 — get the published, versioned spec + prompt for emitting ONE combined setup file (shop profile + store config + catalog) so a seller's own agent can prepare a Miyagi Sánchez shop BEFORE signup. Returns the schema shape, both sub-schemas (config blocks + catalog fields), the manual-only sections, an example, and the es-MX emit prompt (which instructs you to produce all user-facing copy in the seller's own language). Apply path today: the seller signs up and uploads the file via the existing import flow. No auth.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── Tool handlers ──────────────────────────────────────────────────────────────

async function handleSearchListings(args: Record<string, unknown>, baseUrl: string) {
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 20)

  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (args.q)            params.set('q', String(args.q))
  if (args.category)     params.set('category', String(args.category))
  if (args.listing_type) params.set('listing_type', String(args.listing_type))
  if (args.state)        params.set('state', String(args.state))
  if (args.location)     params.set('location', String(args.location))
  if (args.condition)    params.set('condition', String(args.condition))
  if (args.min_price)    params.set('min_price', String(args.min_price))
  if (args.max_price)    params.set('max_price', String(args.max_price))
  if (args.brand)        params.set('brand', String(args.brand))
  if (args.year_from)    params.set('year_from', String(args.year_from))
  if (args.year_to)      params.set('year_to', String(args.year_to))
  if (args.sort)         params.set('sort', String(args.sort))

  let data: { listings?: Listing[] }
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings?${params.toString()}`, { headers: MEDUSA_HEADERS })
    if (!res.ok) return { isError: true, content: [{ type: 'text', text: `Search failed: ${res.status}` }] }
    data = await res.json() as { listings?: Listing[] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }

  const items = (data.listings ?? []).map((l: Listing) => toUcpListing(l, baseUrl))
  if (items.length === 0) return { content: [{ type: 'text', text: 'No listings found matching your search.' }] }

  const summary = items.map(item => {
    const price = item.price ? item.price.formatted : 'Precio a consultar'
    const flags = [
      item.actions.buy_now && '💳 comprar ahora',
      item.actions.make_offer && '🤝 hacer oferta',
      item.actions.escrow_available && '🛡️ pago protegido',
      item.trust.verified_seller && '✓ verificado',
    ].filter(Boolean).join(' · ')
    return `**${item.title}**\n${price} · ${item.location ?? item.state ?? 'México'} · ${item.condition ?? item.listing_type}\n${flags}\nID: \`${item.id}\` | ${item.url}`
  }).join('\n\n---\n\n')

  return { content: [{ type: 'text', text: `Found ${items.length} listings:\n\n${summary}` }, { type: 'text', text: JSON.stringify({ listings: items }, null, 2) }] }
}

async function handleGetNeighborhoodPulse(args: Record<string, unknown>, baseUrl: string) {
  const pulse = await getNeighborhoodPulseAgentView(baseUrl, {
    itemLimit: Number(args.community_limit ?? 12),
    listingLimit: Number(args.trending_limit ?? 8),
    shopLimit: Number(args.shop_limit ?? 6),
  })

  const community = pulse.community_items.slice(0, 5).map((item) =>
    `• ${item.caption} — ${item.type_label}, ${item.zone}`,
  )
  const listings = pulse.trending_listings.slice(0, 5).map((item) =>
    `• ${item.title} — ${item.price?.formatted ?? 'A consultar'} (${item.shop.name})`,
  )
  const shops = pulse.spotlight_shops.slice(0, 5).map((shop) =>
    `• ${shop.name} — ${shop.tagline} · ${shop.colonia}`,
  )

  const summary = [
    '## Pulso del vecindario',
    '',
    `**Solo lectura:** ${pulse._meta.read_only ? 'sí' : 'no'}`,
    '',
    '### Aportes de la comunidad',
    community.length ? community.join('\n') : 'Sin aportes visibles por ahora.',
    '',
    '### Tendencias',
    listings.length ? listings.join('\n') : 'Sin tendencias disponibles por ahora.',
    '',
    '### Comercios que destacan',
    shops.length ? shops.join('\n') : 'Sin comercios destacados por ahora.',
  ].join('\n')

  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(pulse, null, 2) },
    ],
  }
}

async function handleGetListing(args: Record<string, unknown>, baseUrl: string) {
  const id = String(args.id ?? '')

  let listing: Listing | null = null
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${id}`, { headers: MEDUSA_HEADERS })
    if (!res.ok) return { isError: true, content: [{ type: 'text', text: `Listing ${id} not found.` }] }
    const data = await res.json() as { listing?: Listing }
    listing = data.listing ?? null
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }

  if (!listing) return { isError: true, content: [{ type: 'text', text: `Listing ${id} not found.` }] }

  const item = toUcpListing(listing, baseUrl)
  const details = [
    `# ${item.title}`,
    `**Precio:** ${item.price?.formatted ?? 'A consultar'}`,
    `**Condición:** ${item.condition ?? 'No especificada'} · **Tipo:** ${item.listing_type}`,
    `**Ubicación:** ${item.location ?? item.state ?? 'No especificada'}`,
    `**Vendedor:** ${item.shop.name}${item.trust.verified_seller ? ' ✓ verificado' : ''}`,
    '',
    `**Acciones:**`,
    item.actions.buy_now ? `✅ Comprar ahora` : `❌ Compra directa no disponible`,
    item.actions.make_offer ? `✅ Hacer oferta` : `❌ Ofertas no disponibles`,
    item.actions.escrow_required ? `🛡️ Pago protegido OBLIGATORIO` : item.actions.escrow_available ? `🛡️ Pago protegido disponible (opcional)` : '',
    `**Métodos:** ${[item.payment_methods.mercadopago && 'Mercado Pago', item.payment_methods.stripe && 'Stripe'].filter(Boolean).join(', ') || 'Ninguno configurado'}`,
    item.description ? `\n**Descripción:** ${item.description}` : '',
    `**URL:** ${item.url}`,
  ].filter(s => s !== '').join('\n')

  return { content: [{ type: 'text', text: details }, { type: 'text', text: JSON.stringify(item, null, 2) }] }
}

async function handleGetCheckoutOptions(args: Record<string, unknown>, baseUrl: string) {
  const body: Record<string, string> = { listing_id: String(args.listing_id ?? '') }
  if (args.offer_id)    body.offer_id    = String(args.offer_id)
  if (args.buyer_email) body.buyer_email = String(args.buyer_email)

  try {
    const res = await fetch(`${baseUrl}/api/ucp/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json() as { error?: string }
      return { isError: true, content: [{ type: 'text', text: `Failed to get checkout options: ${d.error ?? res.status}` }] }
    }

    const session = await res.json() as {
      price?: { formatted?: string; is_offer_price?: boolean }
      available_count?: number
      recommended_method?: string
      payment_options?: Array<{
        method: string; label: string; description: string; available: boolean;
        instant: boolean; checkout_url?: string; instructions?: string;
        contact_url?: string; bank_details?: { clabe: string; bank_name: string | null; account_holder: string | null }
        reason_unavailable?: string
      }>
      escrow?: { available: boolean; required: boolean; description: string }
    }

    const opts = session.payment_options ?? []
    const available = opts.filter(o => o.available)
    const unavailable = opts.filter(o => !o.available)

    const formatOption = (o: typeof opts[0]) => {
      const lines = [`**${o.label}** ${o.instant ? '⚡ Pago inmediato' : '📋 Coordinación requerida'}`]
      lines.push(o.description)
      if (o.checkout_url) lines.push(`→ Usar create_checkout con method="${o.method}" para generar el enlace de pago`)
      if (o.instructions) lines.push(`📋 ${o.instructions}`)
      if (o.bank_details) {
        lines.push(`🏦 CLABE: \`${o.bank_details.clabe}\``)
        if (o.bank_details.bank_name) lines.push(`   Banco: ${o.bank_details.bank_name}`)
        if (o.bank_details.account_holder) lines.push(`   Titular: ${o.bank_details.account_holder}`)
      }
      if (o.contact_url) lines.push(`📱 ${o.contact_url}`)
      return lines.join('\n')
    }

    const summary = [
      `## Opciones de pago para este anuncio`,
      session.price ? `**Precio:** ${session.price.formatted}${session.price.is_offer_price ? ' (precio negociado ✅)' : ''}` : '',
      session.escrow?.available ? `🛡️ ${session.escrow.description}` : '',
      '',
      `### Disponibles (${available.length})`,
      ...available.map(o => formatOption(o)),
      ...(unavailable.length > 0 ? [
        '',
        `### No disponibles`,
        ...unavailable.map(o => `~~${o.label}~~ — ${o.reason_unavailable ?? 'No disponible'}`),
      ] : []),
      '',
      session.recommended_method
        ? `✨ **Recomendado:** ${available.find(o => o.method === session.recommended_method)?.label ?? session.recommended_method}`
        : '⚠️ No hay métodos de pago disponibles para este anuncio.',
    ].filter(s => s !== '').join('\n\n')

    return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(session, null, 2) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }
}

async function handleCreateCheckout(args: Record<string, unknown>, baseUrl: string) {
  const method = String(args.method ?? 'mercadopago')
  const endpoint = method === 'stripe' ? `${baseUrl}/api/stripe/checkout` : `${baseUrl}/api/mp/checkout`

  const body: Record<string, string> = { listingId: String(args.listing_id) }
  if (args.buyer_email) body.buyerEmail = String(args.buyer_email)
  if (args.offer_id)    body.offerId    = String(args.offer_id)

  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json() as { checkoutUrl?: string; error?: string }
    if (!res.ok || !data.checkoutUrl) return { isError: true, content: [{ type: 'text', text: `Checkout failed: ${data.error ?? 'Unknown error'}` }] }
    return { content: [{ type: 'text', text: `✅ Checkout ready via ${method === 'stripe' ? 'Stripe' : 'Mercado Pago'}.\n\n**Abre este enlace para completar el pago:**\n${data.checkoutUrl}\n\nEl enlace es válido por 30 minutos.` }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }
}

async function handleGetSupportOptions(args: Record<string, unknown>, baseUrl: string) {
  const embedKey = String(args.embed_key ?? '')
  if (!embedKey) {
    return { isError: true, content: [{ type: 'text', text: 'embed_key es obligatorio.' }] }
  }

  try {
    const res = await fetch(`${baseUrl}/api/embed/support?key=${encodeURIComponent(embedKey)}`, {
      headers: { 'x-miyagi-embed-key': embedKey },
    })
    const data = await res.json()
    if (!res.ok || !data.valid) {
      return { isError: true, content: [{ type: 'text', text: 'Apoyos no disponibles para esta llave.' }] }
    }

    const support = data.support ?? {}
    const providers = data.payment_providers ?? {}
    const presets = Array.isArray(support.preset_amount_cents)
      ? support.preset_amount_cents.map((amount: number) => `$${Math.round(amount / 100)} ${support.currency ?? 'MXN'}`).join(', ')
      : 'No configurados'
    const availableProviders = [
      providers.mercadopago && 'Mercado Pago',
      providers.stripe && 'Stripe',
    ].filter(Boolean).join(', ') || 'Ninguno'

    const summary = [
      `## Apoyos para ${data.shop?.name ?? 'esta tienda'}`,
      `**Montos sugeridos:** ${presets}`,
      `**Rango personalizado:** $${Math.round((support.custom_min_cents ?? 0) / 100)} - $${Math.round((support.custom_max_cents ?? 0) / 100)} ${support.currency ?? 'MXN'}`,
      `**Visibilidad predeterminada:** ${support.default_visibility === 'private' ? 'privado' : 'público'}`,
      `**Métodos disponibles:** ${availableProviders}`,
    ].join('\n\n')

    return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(data, null, 2) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }
}

async function handleCreateSupportCheckout(args: Record<string, unknown>, baseUrl: string) {
  const embedKey = String(args.embed_key ?? '')
  const amountCents = Math.round(Number(args.amount_cents ?? 0))
  const supporterEmail = String(args.supporter_email ?? '')
  const provider = String(args.provider ?? 'mercadopago')
  if (!embedKey || !amountCents || !supporterEmail) {
    return { isError: true, content: [{ type: 'text', text: 'Faltan campos requeridos: embed_key, amount_cents, supporter_email.' }] }
  }

  try {
    const res = await fetch(`${baseUrl}/api/embed/support/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-miyagi-embed-key': embedKey },
      body: JSON.stringify({
        embed_key: embedKey,
        amount_cents: amountCents,
        provider,
        supporter_email: supporterEmail,
        supporter_name: args.supporter_name ? String(args.supporter_name) : undefined,
        message: args.message ? String(args.message) : undefined,
        visibility: args.visibility === 'private' ? 'private' : 'public',
      }),
    })
    const data = await res.json() as { checkout_url?: string; redirect_url?: string; error?: string }
    const checkoutUrl = data.checkout_url ?? data.redirect_url
    if (!res.ok || !checkoutUrl) {
      return { isError: true, content: [{ type: 'text', text: `Support checkout failed: ${data.error ?? 'Unknown error'}` }] }
    }
    return { content: [{ type: 'text', text: `✅ Checkout de apoyo listo.\n\n**Abre este enlace para completar el apoyo:**\n${checkoutUrl}` }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }
}

async function handleMakeOffer(args: Record<string, unknown>, baseUrl: string, authHeader?: string | null) {
  const listingId  = String(args.listing_id ?? '')
  const amount     = Number(args.offer_amount)
  const buyerName  = String(args.buyer_name ?? '')
  const buyerEmail = String(args.buyer_email ?? '')

  if (!listingId || isNaN(amount) || !buyerName || !buyerEmail) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required fields: listing_id, offer_amount, buyer_name, buyer_email' }] }
  }

  let listing: { id: string; title: string; price_cents: number | null; listing_type: string } | null = null
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${listingId}`, { headers: MEDUSA_HEADERS })
    if (res.ok) {
      const d = await res.json() as { listing?: Listing }
      if (d.listing?.status === 'active') listing = d.listing
    }
  } catch { /* listing stays null */ }

  if (!listing) return { isError: true, content: [{ type: 'text', text: 'Listing not found or no longer active.' }] }
  if (listing.listing_type === 'digital') return { isError: true, content: [{ type: 'text', text: 'Digital products do not accept offers. Use create_checkout instead.' }] }

  const offerCents = Math.round(amount * 100)
  if (listing.price_cents && offerCents > listing.price_cents) {
    return { isError: true, content: [{ type: 'text', text: `Offer ($${amount}) exceeds list price ($${(listing.price_cents/100).toFixed(2)}). Use create_checkout to buy at list price.` }] }
  }

  const res = await fetch(`${baseUrl}/api/offers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify({ listingId, offerAmountCents: offerCents, buyerName, buyerEmail, message: args.message }),
  })
  const data = await res.json() as { offerId?: string; id?: string; error?: string; requiresAuth?: boolean }
  const offerId = data.offerId ?? data.id
  if (res.status === 401 || data.requiresAuth) {
    return { isError: true, content: [{ type: 'text', text: 'Offer requires an authenticated Miyagi buyer session. Sign in at miyagisanchez.com, then retry from the authenticated client.' }] }
  }
  if (!res.ok || !offerId) return { isError: true, content: [{ type: 'text', text: `Offer failed: ${data.error ?? 'Unknown error'}` }] }

  return { content: [{ type: 'text', text: `✅ Offer submitted!\n\n**Offer ID:** \`${offerId}\`\n**Amount:** $${amount.toLocaleString('es-MX')} MXN\n**Listing:** ${listing.title}\n\nSeller has 48h to respond. If accepted → call create_checkout with offer_id="${offerId}"` }] }
}

async function handleGetShop(args: Record<string, unknown>, baseUrl: string) {
  const slug  = String(args.shop_slug ?? '')
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10)), 20)

  let seller: Record<string, unknown> | null = null
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/sellers/${slug}`, { headers: MEDUSA_HEADERS })
    if (!res.ok) return { isError: true, content: [{ type: 'text', text: `Shop "${slug}" not found.` }] }
    const d = await res.json() as { seller?: Record<string, unknown> }
    seller = d.seller ?? null
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Network error: ${String(e)}` }] }
  }

  if (!seller) return { isError: true, content: [{ type: 'text', text: `Shop "${slug}" not found.` }] }

  let listings: ReturnType<typeof toUcpListing>[] = []
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings?seller_slug=${encodeURIComponent(slug)}&limit=${limit}`, { headers: MEDUSA_HEADERS })
    if (res.ok) {
      const d = await res.json() as { listings?: Listing[] }
      listings = (d.listings ?? []).map(l => toUcpListing(l, baseUrl))
    }
  } catch { /* listings stays empty */ }

  const isClaimed = isShopClaimed({ clerk_user_id: seller.clerk_user_id == null ? null : String(seller.clerk_user_id) })

  const profile = [
    `# ${seller.name}${seller.verified ? ' ✓ verificado' : ''}`,
    seller.description ? `\n${seller.description}\n` : '',
    `**Ubicación:** ${seller.location ?? 'No especificada'}`,
    `**Tienda reclamada:** ${isClaimed ? 'Sí' : 'No'}`,
    `**URL:** ${baseUrl}/s/${seller.slug}`,
    `\n**${listings.length} anuncios activos:**`,
    ...listings.map(item => `• ${item.title} — ${item.price?.formatted ?? 'A consultar'} (ID: \`${item.id}\`)`),
  ].filter(s => s !== '').join('\n')

  return { content: [{ type: 'text', text: profile }, { type: 'text', text: JSON.stringify({ shop: seller, listings }, null, 2) }] }
}

async function getShopCalcom(listingId: string): Promise<{
  apiKey: string; eventTypeId: number; bookingUrl: string; listing: { title: string; category: string | null }
} | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${listingId}`, { headers: MEDUSA_HEADERS })
    if (!res.ok) return null
    const data = await res.json() as { listing?: Listing }
    const listing = data.listing
    if (!listing?.shop) return null
    const shopMeta = (listing.shop.metadata ?? {}) as Record<string, unknown>
    const calcomApiKey = (shopMeta.calcom_api_key as string | null) ?? null
    if (!calcomApiKey) return null
    const calcomSettings = ((shopMeta.settings as Record<string, unknown> | undefined)?.calcom) as {
      event_type_id?: number; booking_url?: string; connected?: boolean
    } | undefined
    if (!calcomSettings?.connected || !calcomSettings.event_type_id) return null
    return {
      apiKey: calcomApiKey,
      eventTypeId: calcomSettings.event_type_id,
      bookingUrl: ensureUrlProtocol(calcomSettings.booking_url) ?? '',
      listing: { title: listing.title, category: listing.category },
    }
  } catch {
    return null
  }
}

// ── Link-only scheduling fallback ─────────────────────────────────────────────

async function getShopSchedulingLinks(listingId: string): Promise<{ bookingUrl: string; label: string; title: string } | null> {
  try {
    const res = await fetch(`${MEDUSA_BASE}/store/listings/${listingId}`, { headers: MEDUSA_HEADERS })
    if (!res.ok) return null
    const data = await res.json() as { listing?: Listing }
    const listing = data.listing
    if (!listing?.shop) return null
    const shopMeta = (listing.shop.metadata ?? {}) as Record<string, unknown>
    const schedulingMeta = ((shopMeta.settings as Record<string, unknown> | undefined)?.scheduling ?? {}) as { links?: Array<{ label: string; url: string }> }
    const firstLink = schedulingMeta.links?.[0]
    if (!firstLink?.url) return null
    return { bookingUrl: ensureUrlProtocol(firstLink.url) ?? firstLink.url, label: firstLink.label || 'Reservas en línea', title: listing.title }
  } catch {
    return null
  }
}

async function handleCheckAvailability(args: Record<string, unknown>) {
  const listingId = String(args.listing_id ?? '')
  if (!listingId) return { isError: true, content: [{ type: 'text', text: 'listing_id is required' }] }

  const cal = await getShopCalcom(listingId)
  if (!cal) {
    // Try link-only fallback — seller pasted a booking link without an API key
    const linkSchedule = await getShopSchedulingLinks(listingId)
    if (!linkSchedule) {
      return { isError: true, content: [{ type: 'text', text: 'This listing does not have scheduling enabled. Use the booking_url from get_listing to book directly.' }] }
    }
    return {
      content: [{
        type: 'text',
        text: [
          `## Agendamiento — ${linkSchedule.title}`,
          '',
          `This seller uses a **manual booking link** (${linkSchedule.label}). Real-time availability checking is not available, but you can book directly:`,
          '',
          `🔗 **${linkSchedule.bookingUrl}**`,
          '',
          'Open the link to see available times and complete your booking. The seller will receive a confirmation notification.',
          '',
          `> **Note:** If the buyer prefers AI-assisted booking with real-time availability, suggest the seller connect their Cal.com API key in their shop settings.`,
        ].join('\n'),
      }, {
        type: 'text',
        text: JSON.stringify({ listing_id: listingId, mode: 'link_only', booking_url: linkSchedule.bookingUrl }, null, 2),
      }],
    }
  }

  const today    = new Date()
  const dateFrom = String(args.date_from ?? today.toISOString().slice(0, 10))
  const dateTo   = String(args.date_to ?? new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10))
  const timezone = String(args.timezone ?? 'America/Mexico_City')

  let slots: Record<string, Array<{ time: string }>>
  try {
    slots = await getCalAvailableSlots(cal.apiKey, cal.eventTypeId, dateFrom, dateTo, timezone)
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Could not fetch availability: ${String(err)}` }] }
  }

  const days = Object.entries(slots).filter(([, daySlots]) => daySlots.length > 0)
  if (days.length === 0) {
    return { content: [{ type: 'text', text: `No available slots for **${cal.listing.title}** between ${dateFrom} and ${dateTo}.\n\nTry a wider date range or contact the seller directly.` }] }
  }

  const summary = [
    `## Disponibilidad para ${cal.listing.title}`,
    `📅 **${days.length} día${days.length > 1 ? 's' : ''} disponibles** (${dateFrom} → ${dateTo})`,
    '',
    ...days.map(([date, daySlots]) => {
      const d = new Date(date)
      const dayLabel = d.toLocaleDateString('es-MX', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone })
      const times = daySlots.slice(0, 8).map(s => {
        const t = new Date(s.time)
        return t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
      }).join(' · ')
      return `**${dayLabel}**\n${times}${daySlots.length > 8 ? ` +${daySlots.length - 8} más` : ''}`
    }),
    '',
    '→ Use `book_appointment` with the `start_time` in ISO 8601 format to confirm a slot.',
  ].join('\n')

  return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify({ listing_id: listingId, slots }, null, 2) }] }
}

async function handleBookAppointment(args: Record<string, unknown>) {
  const listingId  = String(args.listing_id ?? '')
  const startTime  = String(args.start_time ?? '')
  const buyerName  = String(args.buyer_name ?? '')
  const buyerEmail = String(args.buyer_email ?? '')
  const timezone   = String(args.timezone ?? 'America/Mexico_City')

  if (!listingId || !startTime || !buyerName || !buyerEmail) {
    return { isError: true, content: [{ type: 'text', text: 'Required: listing_id, start_time, buyer_name, buyer_email' }] }
  }

  const cal = await getShopCalcom(listingId)
  if (!cal) {
    // Try link-only fallback
    const linkSchedule = await getShopSchedulingLinks(listingId)
    if (!linkSchedule) {
      return { isError: true, content: [{ type: 'text', text: 'This listing does not have scheduling enabled.' }] }
    }
    return {
      content: [{
        type: 'text',
        text: [
          `## Booking Required — ${linkSchedule.title}`,
          '',
          `This seller manages their own booking via ${linkSchedule.label}. I cannot book on your behalf, but here's the direct link:`,
          '',
          `🔗 **${linkSchedule.bookingUrl}**`,
          '',
          `Share this link with the buyer so they can select their preferred time. The confirmation will be sent to their email.`,
        ].join('\n'),
      }],
    }
  }

  let booking
  try {
    booking = await createCalBooking(
      cal.apiKey,
      cal.eventTypeId,
      startTime,
      buyerName,
      buyerEmail,
      timezone,
      args.notes ? String(args.notes) : undefined
    )
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Booking failed: ${String(err)}` }] }
  }

  const startDate = new Date(booking.startTime)
  const formattedDate = startDate.toLocaleString('es-MX', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  })
  const agendarLabel = cal.listing.category === 'autos' ? 'prueba de manejo'
    : cal.listing.category === 'inmuebles' ? 'visita' : 'cita'

  const summary = [
    `## ✅ ${agendarLabel.charAt(0).toUpperCase() + agendarLabel.slice(1)} agendada`,
    '',
    `**Anuncio:** ${cal.listing.title}`,
    `**Fecha:** ${formattedDate}`,
    `**Confirmación enviada a:** ${buyerEmail}`,
    `**Booking ID:** \`${booking.uid}\``,
    '',
    `El vendedor también recibió una notificación. Revisa tu correo para más detalles.`,
  ].join('\n')

  return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(booking, null, 2) }] }
}

async function handleGetBuyerTrust(args: Record<string, unknown>) {
  const identifier = String(args.identifier ?? '').trim()
  if (!identifier) {
    return { isError: true, content: [{ type: 'text', text: 'identifier is required (email or Clerk user ID)' }] }
  }

  const isClerkId = identifier.startsWith('user_')
  const isEmail   = !isClerkId && identifier.includes('@')
  if (!isClerkId && !isEmail) {
    return { isError: true, content: [{ type: 'text', text: 'identifier must be an email address or Clerk user ID (user_xxx)' }] }
  }

  const trust = await computeTrustScore(identifier)

  const earned   = trust.signals.filter(s => s.earned)
  const unearned = trust.signals.filter(s => !s.earned)

  const summary = [
    `## OmniReputation — ${trust.level_label}`,
    `**Score:** ${trust.score}/100 · **Nivel:** ${trust.level}`,
    `**Buyer:** ${identifier}`,
    '',
    `### Señales obtenidas (${earned.length})`,
    ...earned.map(s => `✅ ${s.label} (+${s.points} pts) — ${s.description}`),
    ...(unearned.length > 0 ? [
      '',
      `### Señales no obtenidas (${unearned.length})`,
      ...unearned.map(s => `⬜ ${s.label} (+${s.points} pts) — ${s.description}`),
    ] : []),
    '',
    `*Calculado: ${trust.computed_at}*`,
  ].join('\n')

  return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(trust, null, 2) }] }
}

// ── Seller-side config tools (Sprint 4) ───────────────────────────────────────

const AGENT_AUTH_HINT =
  'This is a seller tool. Provide your shop agent token as `Authorization: Bearer ms_agent_…`. ' +
  'Generate or rotate it under “Agentes e integraciones” in your Miyagi Sánchez shop settings. ' +
  'The token is scoped to a single shop.'

async function handleGetStoreConfiguration(authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) {
    return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  }

  const snapshot = buildStoreConfigSnapshot(shop)
  const manualLines = snapshot.manual_sections.map((m) => `- ${m.label}: ${m.why}`).join('\n')
  const summary = [
    `## Configuración de ${shop.name ?? 'tu tienda'}`,
    `**Bloques con datos:** ${snapshot.configured_blocks.length ? snapshot.configured_blocks.join(', ') : 'ninguno aún'}`,
    '',
    'Estos bloques son editables con `patch_store_configuration`. Lo siguiente requiere un paso manual y NO se puede cambiar por agente:',
    manualLines,
  ].join('\n')

  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(snapshot, null, 2) },
    ],
  }
}

async function handlePatchStoreConfiguration(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) {
    return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  }

  // Accept either { configuration: {...} } or the manifest at the top level.
  const raw = (args.configuration && typeof args.configuration === 'object' && !Array.isArray(args.configuration))
    ? args.configuration as Record<string, unknown>
    : args
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return { isError: true, content: [{ type: 'text', text: 'Provide a `configuration` object with at least one block to change.' }] }
  }

  // Flag OAuth/manual blocks the agent tried to set — we ignore them by design.
  const manualKeys = new Set(MANUAL_SECTIONS.map((m) => m.key))
  const ignoredManual = Object.keys(raw).filter((k) => manualKeys.has(k))

  const result = await applyStoreConfig(shop.clerk_user_id, null, raw as StoreConfigManifest)

  if (!result.ok) {
    const issues = result.blocks.flatMap((b) => b.issues.map((i) => `- ${b.label}: ${i}`)).join('\n')
    return {
      isError: true,
      content: [{ type: 'text', text: `No se aplicó ningún cambio. ${result.error ?? ''}${issues ? `\n\n${issues}` : ''}` }],
    }
  }

  // Refresh storefront/PDP caches so the change shows immediately.
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  // Operational audit log + security notifications (best-effort, never blocks).
  await recordAgentConfigChange(shop, result)

  const lines = result.blocks.map((b) =>
    b.status === 'applied'
      ? `✅ ${b.label}: ${b.appliedFields.join(', ')}${b.issues.length ? ` (omitidos: ${b.issues.join('; ')})` : ''}`
      : `⏭️ ${b.label}: sin cambios válidos${b.issues.length ? ` (${b.issues.join('; ')})` : ''}`,
  )
  const summary = [
    `## Configuración actualizada — ${shop.name ?? 'tu tienda'}`,
    ...lines,
    ...(ignoredManual.length ? ['', `⚠️ Ignorado (requiere paso manual): ${ignoredManual.join(', ')}`] : []),
  ].join('\n')

  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify({ ok: true, blocks: result.blocks, ignored_manual: ignoredManual }, null, 2) },
    ],
  }
}

async function handleListOffers(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) {
    return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  }

  const offers = await listShopOffers(shop.id, { actionableOnly: args.pending_only === true })
  if (offers.length === 0) {
    return { content: [{ type: 'text', text: 'No hay ofertas abiertas en este momento.' }] }
  }

  const lines = offers.map((o) =>
    `• **${o.listing_title}** — ${o.offer_amount} (${o.pct_of_asking}% de ${o.list_price}, ${o.quality}) ` +
    `· ${o.buyer_name} · ${o.status}${o.status === 'countered' && o.counter_amount ? ` (contraoferta ${o.counter_amount})` : ''} ` +
    `· vence en ${o.expires_in}\n  id: \`${o.id}\`${o.message ? `\n  «${o.message}»` : ''}`,
  )
  const summary = [`## Ofertas abiertas (${offers.length})`, ...lines].join('\n')

  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify({ offers }, null, 2) },
    ],
  }
}

async function handleRespondToOffer(args: Record<string, unknown>, baseUrl: string, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) {
    return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  }

  const offerId = String(args.offer_id ?? '')
  const action = String(args.action ?? '') as 'accept' | 'counter' | 'decline'
  if (!offerId || !['accept', 'counter', 'decline'].includes(action)) {
    return { isError: true, content: [{ type: 'text', text: 'Provide offer_id and action (accept | counter | decline).' }] }
  }
  const counterAmountCents = action === 'counter' && typeof args.counter_amount_mxn === 'number'
    ? Math.round(args.counter_amount_mxn * 100)
    : undefined

  const result = await respondToOffer({
    offerId,
    authorizedClerkUserId: shop.clerk_user_id,
    origin: baseUrl,
    action,
    counterAmountCents,
    counterMessage: args.counter_message ? String(args.counter_message) : undefined,
  })

  if (!result.ok) {
    return { isError: true, content: [{ type: 'text', text: `No se pudo responder la oferta: ${result.error}` }] }
  }

  // Audit + admin notification (best-effort; never fails the response).
  await recordAgentOfferAction(shop, { offerId, action, counterAmountCents })

  const msg = result.status === 'accepted'
    ? '✅ Oferta aceptada. Se envió al comprador el enlace de pago — la venta queda comprometida a ese precio.'
    : result.status === 'countered'
      ? '✅ Contraoferta enviada al comprador.'
      : '✅ Oferta rechazada.'
  return {
    content: [
      { type: 'text', text: msg },
      { type: 'text', text: JSON.stringify({ ok: true, status: result.status, offer_id: offerId }, null, 2) },
    ],
  }
}

async function handleCreateListing(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  if (!shop.slug) return { isError: true, content: [{ type: 'text', text: 'Tu tienda no tiene un identificador (slug) configurado.' }] }

  // Shape the agent's args into a catalog-import row and re-validate server-side
  // (never trust the agent) — reuses the exact rules the bulk importer enforces.
  const raw: Record<string, unknown> = {
    title: args.title,
    category: args.category,
    description: args.description,
    price: args.price_mxn,
    currency: args.currency,
    listing_type: args.listing_type,
    condition: args.condition,
    quantity: args.quantity,
    state: args.state,
    city: args.city,
    images: args.images,
    weight_grams: args.weight_grams,
  }
  const [staged] = validateRows([raw])
  if (!staged?.valid) {
    const reason = staged?.issues.find((i) => i.level === 'error')?.message ?? 'Datos del anuncio inválidos.'
    return { isError: true, content: [{ type: 'text', text: `No se pudo crear el anuncio: ${reason}` }] }
  }
  const row: CatalogImportRow = staged.row
  const listingType = row.listing_type ?? 'product'
  const isStockable = listingType === 'product'

  // Pull any remote image URLs into our R2 pipeline (SSRF-guarded, capped,
  // graceful per-image fallback — same path as bulk import).
  const ingest = await ingestImageUrls(shop.clerk_user_id, row.images ?? [], row.title)

  // Viability guardrail: a physical product the shop can't actually sell yet
  // (no delivery AND/OR no payment) is created as a draft, never a live listing
  // no buyer could check out.
  const block = isStockable ? listingActivationBlock(shop.metadata, 'product') : null
  const status: 'published' | 'draft' = block ? 'draft' : 'published'

  const priceCents = row.price != null ? Math.round(row.price * 100) : null
  const location = [row.city?.trim(), row.state?.trim()].filter(Boolean).join(', ') || null

  const result = await createSellerProductViaInternal(shop.slug, {
    title: row.title,
    description: row.description ?? null,
    price_cents: priceCents,
    currency: row.currency ?? 'MXN',
    condition: isStockable ? (row.condition ?? null) : null,
    listing_type: listingType,
    category: row.category,
    state: row.state || null,
    municipio: row.city || null,
    location,
    quantity: isStockable ? Math.max(1, Math.floor(row.quantity ?? 1)) : 1,
    weight_grams: row.weight_grams ?? null,
    status,
    images: ingest.images,
  })
  if (!result.ok || !result.product_id) {
    return { isError: true, content: [{ type: 'text', text: `No se pudo crear el anuncio: ${result.error}` }] }
  }
  const productId = result.product_id

  // Mirror to the Supabase storefront copy so it shows in the portal + list_my_listings.
  await syncSupabaseListingMirror(shop.id, {
    id: productId,
    title: row.title,
    description: row.description ?? null,
    price_cents: priceCents,
    currency: row.currency ?? 'MXN',
    condition: isStockable ? (row.condition ?? null) : null,
    listing_type: listingType,
    category: row.category,
    state: row.state || null,
    municipio: row.city || null,
    location,
    images: ingest.images,
    status: status === 'published' ? 'active' : 'paused',
  })

  await recordAgentListingCreate(shop, { productId, title: row.title, status })
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  const imgNote = ingest.failed > 0 ? ` (${ingest.failed} imagen(es) no se pudieron importar)` : ''
  const draftNote = status === 'draft' ? `\n⚠️ Guardado como borrador (pausado). ${block}` : ''
  return {
    content: [
      { type: 'text', text: `✅ Anuncio creado${status === 'published' ? ' y publicado' : ''}: «${row.title}».${imgNote}${draftNote}\n\nproduct_id: \`${productId}\`` },
    ],
  }
}

async function handleListMyListings(authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }

  const listings = await listShopListings(shop.id)
  if (listings.length === 0) return { content: [{ type: 'text', text: 'No tienes anuncios todavía.' }] }

  const lines = listings.map((l) =>
    `• **${l.title}** — ${l.price ?? 'sin precio'} · ${l.status} · ${l.listing_type}\n  product_id: \`${l.product_id}\``,
  )
  return {
    content: [
      { type: 'text', text: [`## Tus anuncios (${listings.length})`, ...lines].join('\n') },
      { type: 'text', text: JSON.stringify({ listings }, null, 2) },
    ],
  }
}

async function handleListMyCollections(authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  if (!shop.slug) return { isError: true, content: [{ type: 'text', text: 'Tu tienda no tiene un identificador (slug) configurado.' }] }

  const collections = await getShopCollections(shop.slug)
  if (collections.length === 0) return { content: [{ type: 'text', text: 'Aún no tienes colecciones. Créalas en el portal de tu tienda (Colecciones).' }] }

  const shaped = collections.map((c) => ({ name: c.name, slug: shortCollectionSlug(c.handle, shop.slug!) }))
  const lines = shaped.map((c) => `• **${c.name}** (slug: \`${c.slug}\`)`)
  return {
    content: [
      { type: 'text', text: [`## Tus colecciones (${shaped.length})`, ...lines].join('\n') },
      { type: 'text', text: JSON.stringify({ collections: shaped }, null, 2) },
    ],
  }
}

async function handleListOrders(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  if (!shop.slug) return { isError: true, content: [{ type: 'text', text: 'Tu tienda no tiene un identificador (slug) configurado.' }] }

  const result = await listShopOrdersViaInternal(shop.slug)
  if (!result.ok) return { isError: true, content: [{ type: 'text', text: `No se pudieron leer los pedidos: ${result.error}` }] }

  const statusFilter = typeof args.status === 'string' ? args.status : null
  const sourceFilter = args.source === 'mercadolibre' || args.source === 'miyagi' ? args.source : null
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 20

  let orders = result.orders ?? []
  if (statusFilter) orders = orders.filter((o) => o.status === statusFilter)
  if (sourceFilter) orders = orders.filter((o) => o.source === sourceFilter)
  orders = orders.slice(0, limit)

  if (orders.length === 0) return { content: [{ type: 'text', text: 'No tienes pedidos que coincidan con ese filtro.' }] }

  const lines = orders.map((o) => {
    const tags = o.tags.length ? ` · tags: ${o.tags.join(', ')}` : ''
    return `• **${o.id}** — ${o.status} · ${o.source} · ${(o.amount_cents / 100).toFixed(2)} ${o.currency}${tags}\n  comprador: ${o.buyer_name ?? o.buyer_email ?? '—'}`
  })
  return {
    content: [
      { type: 'text', text: [`## Tus pedidos (${orders.length})`, ...lines].join('\n') },
      { type: 'text', text: JSON.stringify({ orders }, null, 2) },
    ],
  }
}

async function handleUpdateListing(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  if (!shop.slug) return { isError: true, content: [{ type: 'text', text: 'Tu tienda no tiene un identificador (slug) configurado.' }] }

  const productId = String(args.product_id ?? '')
  if (!productId) return { isError: true, content: [{ type: 'text', text: 'product_id es obligatorio.' }] }
  const owned = await shopOwnsProduct(shop.id, productId)
  if (!owned) return { isError: true, content: [{ type: 'text', text: 'Ese anuncio no pertenece a tu tienda.' }] }

  const patch: { title?: string; description?: string | null; price_cents?: number | null; quantity?: number | null; collection_ids?: string[] } = {}
  const fields: string[] = []
  if (typeof args.title === 'string') { patch.title = args.title; fields.push('title') }
  if (typeof args.description === 'string') { patch.description = args.description; fields.push('description') }
  if (typeof args.price_mxn === 'number') { patch.price_cents = Math.round(args.price_mxn * 100); fields.push('price') }
  if (typeof args.quantity === 'number') { patch.quantity = Math.max(0, Math.floor(args.quantity)); fields.push('quantity') }
  if (Array.isArray(args.collection_names)) {
    const requestedNames = args.collection_names.filter((n): n is string => typeof n === 'string')
    const shopCollections = await getShopCollections(shop.slug)
    const byName = new Map(shopCollections.map((c) => [c.name.toLowerCase(), c]))
    const unknown = requestedNames.filter((n) => !byName.has(n.toLowerCase()))
    if (unknown.length > 0) {
      return { isError: true, content: [{ type: 'text', text: `No reconozco estas colecciones: ${unknown.join(', ')}. Usa list_my_collections para ver los nombres exactos.` }] }
    }
    patch.collection_ids = requestedNames.map((n) => byName.get(n.toLowerCase())!.id)
    fields.push('collections')
  }
  if (fields.length === 0) {
    return { isError: true, content: [{ type: 'text', text: 'Indica al menos un campo a cambiar: title, description, price_mxn, quantity o collection_names.' }] }
  }

  const result = await patchSellerProductViaInternal(shop.slug, productId, patch)
  if (!result.ok) return { isError: true, content: [{ type: 'text', text: `No se pudo actualizar el anuncio: ${result.error}` }] }

  // Mirror to the Supabase storefront copy (matches the portal route).
  const mirror: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) mirror.title = patch.title.trim()
  if (patch.description !== undefined) mirror.description = patch.description
  if (patch.price_cents !== undefined) mirror.price_cents = patch.price_cents
  if (Object.keys(mirror).length > 1) {
    await db.from('marketplace_listings').update(mirror).eq('medusa_product_id', productId)
  }

  await recordAgentListingAction(shop, { productId, fields, title: patch.title })
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return { content: [{ type: 'text', text: `✅ Anuncio actualizado: ${fields.join(', ')}.` }] }
}

async function handleSetListingStatus(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }
  if (!shop.slug) return { isError: true, content: [{ type: 'text', text: 'Tu tienda no tiene un identificador (slug) configurado.' }] }

  const productId = String(args.product_id ?? '')
  const status = String(args.status ?? '')
  if (!productId || !['active', 'paused'].includes(status)) {
    return { isError: true, content: [{ type: 'text', text: 'Indica product_id y status ("active" o "paused").' }] }
  }
  const owned = await shopOwnsProduct(shop.id, productId)
  if (!owned) return { isError: true, content: [{ type: 'text', text: 'Ese anuncio no pertenece a tu tienda.' }] }

  if (status === 'active') {
    const block = listingActivationBlock(shop.metadata, owned.listing_type)
    if (block) return { isError: true, content: [{ type: 'text', text: block }] }
  }

  const result = await patchSellerProductViaInternal(shop.slug, productId, { status: status === 'active' ? 'published' : 'draft' })
  if (!result.ok) return { isError: true, content: [{ type: 'text', text: `No se pudo cambiar el estado: ${result.error}` }] }

  await db.from('marketplace_listings').update({ status, updated_at: new Date().toISOString() }).eq('medusa_product_id', productId)
  await recordAgentListingAction(shop, { productId, fields: [`status:${status}`] })
  revalidateTag('listings', 'default')
  revalidateTag('shops', 'default')

  return { content: [{ type: 'text', text: `✅ Anuncio ${status === 'active' ? 'activado' : 'pausado'}.` }] }
}

// ── Custom-domain paywall (epic 07 · S3) — seller-agent domain SKU tools ──────

async function handleGetDomainEntitlement(authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }

  const ent = await resolveDomainEntitlement(shop.metadata, { sellerClerkId: shop.clerk_user_id })
  const summary = ent.entitled
    ? `✅ ${shop.name ?? 'Tu tienda'} puede conectar un dominio propio (motivo: ${ent.reason}).`
    : `🔒 El dominio propio es una función premium (${CUSTOM_DOMAIN_PRICE_LABEL.es}). Tu tienda aún no está habilitada. ` +
      `El cupón “${CAMPAIGN_COUPON_CODE}” cubre gratis el primer año (sujeto a disponibilidad). El subdominio y tu URL gratis siempre son gratis. ` +
      `Usa start_domain_subscription para activar.`

  return {
    content: [
      { type: 'text', text: summary },
      {
        type: 'text',
        text: JSON.stringify(
          {
            entitled: ent.entitled,
            reason: ent.reason,
            price_label: CUSTOM_DOMAIN_PRICE_LABEL.es,
            campaign_coupon: CAMPAIGN_COUPON_CODE,
          },
          null,
          2,
        ),
      },
    ],
  }
}

async function handleStartDomainSubscription(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }

  const couponCode = typeof args.coupon === 'string' ? args.coupon : null
  const cadence = asDomainCadence(args.cadence) ?? 'recurring'
  const result = await startCustomDomainCheckout({
    shopId: shop.id,
    sellerClerkId: shop.clerk_user_id,
    channel: 'api',
    couponCode,
    cadence,
  })

  if (!result.ok) {
    return { isError: true, content: [{ type: 'text', text: result.error }] }
  }

  const cadenceNote = cadence === 'one_time'
    ? ' (pago único por un año, sin renovación automática)'
    : ''
  return {
    content: [
      {
        type: 'text',
        text:
          `Abre este enlace para activar tu dominio propio${cadenceNote}${couponCode ? ` con el cupón “${couponCode}”` : ''}:\n${result.url}\n\n` +
          'La habilitación se activa automáticamente al completar el checkout.',
      },
      { type: 'text', text: JSON.stringify({ checkout_url: result.url, cadence }, null, 2) },
    ],
  }
}

// ── Subdomain paywall (epic 07 · subdomain-pricing S2) — seller-agent SKU tools ─

async function handleGetSubdomainEntitlement(authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }

  const ent = await resolveSubdomainEntitlement(shop.metadata, { sellerClerkId: shop.clerk_user_id })
  const summary = ent.entitled
    ? `✅ ${shop.name ?? 'Tu tienda'} puede servir su subdominio white-label (motivo: ${ent.reason}).`
    : `🔒 El subdominio propio es una función premium (${SUBDOMAIN_PRICE_LABEL.es}). Tu tienda aún no está habilitada. ` +
      `Tu URL gratis (/s/tu-tienda) siempre es gratis. Usa start_subdomain_subscription para activar.`

  return {
    content: [
      { type: 'text', text: summary },
      {
        type: 'text',
        text: JSON.stringify(
          {
            entitled: ent.entitled,
            reason: ent.reason,
            price_label: SUBDOMAIN_PRICE_LABEL.es,
            monthly_price_label: SUBDOMAIN_PRICE_MONTHLY_LABEL.es,
          },
          null,
          2,
        ),
      },
    ],
  }
}

async function handleStartSubdomainSubscription(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }

  const cadence = asDomainCadence(args.cadence) ?? 'recurring'
  const interval = coerceSubdomainInterval(args.interval)
  const result = await startSubdomainCheckout({
    shopId: shop.id,
    sellerClerkId: shop.clerk_user_id,
    channel: 'api',
    cadence,
    interval,
  })

  if (!result.ok) {
    return { isError: true, content: [{ type: 'text', text: result.error }] }
  }

  const cadenceNote = cadence === 'one_time'
    ? ' (pago único por un año, sin renovación automática)'
    : interval === 'month'
      ? ' (suscripción mensual, $25 MXN/mes)'
      : ' (suscripción anual, $199 MXN/año)'
  return {
    content: [
      {
        type: 'text',
        text:
          `Abre este enlace para activar tu subdominio propio${cadenceNote}:\n${result.url}\n\n` +
          'La habilitación se activa automáticamente al completar el checkout.',
      },
      { type: 'text', text: JSON.stringify({ checkout_url: result.url, cadence, interval }, null, 2) },
    ],
  }
}

async function handleSwitchSubdomainCadence(args: Record<string, unknown>, authHeader?: string | null) {
  const shop = await resolveAgentShop(authHeader)
  if (!shop) return { isError: true, content: [{ type: 'text', text: `Unauthorized. ${AGENT_AUTH_HINT}` }] }

  // Pass the raw arg — the switch builder validates it strictly (a billing mutation
  // rejects a missing/invalid interval rather than defaulting).
  const result = await switchSubdomainCadence({
    sellerClerkId: shop.clerk_user_id,
    targetInterval: args.interval,
  })

  if (!result.ok) {
    return { isError: true, content: [{ type: 'text', text: result.error }] }
  }

  const label = result.interval === 'month' ? '$25 MXN/mes' : '$199 MXN/año'
  const text = result.switched
    ? `✅ Tu suscripción al subdominio cambió a ${label}. Se prorrateó el cambio (sin cargo doble) y tu subdominio siguió activo sin interrupción.`
    : `Tu suscripción al subdominio ya está en ${label}. No se hizo ningún cambio ni cargo.`
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify({ switched: result.switched, interval: result.interval }, null, 2) },
    ],
  }
}

// ── MCP method dispatcher ─────────────────────────────────────────────────────

function handleAboutMiyagi(baseUrl: string) {
  const resource = aboutMcpResource(baseUrl)
  // Tool result: the structured story as a JSON text block. The directive is
  // embedded so the client answers in the user's own language.
  return { content: [{ type: 'text', text: resource.text }] }
}

function handleGetSetupSpec() {
  // The full published setup contract: schema shape + both sub-schemas + example +
  // the es-MX emit prompt (which carries the mirror-the-seller's-language directive).
  const spec = buildSetupSpec()
  return { content: [{ type: 'text', text: JSON.stringify(spec, null, 2) }] }
}

async function handleMcpMethod(method: string, params: Record<string, unknown> | undefined, baseUrl: string, authHeader?: string | null) {
  // Standard MCP lifecycle
  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'miyagisanchez', version: '1.0.0' },
      instructions: 'Miyagi Sánchez marketplace for Mexico. BUYER workflow: search_listings → get_neighborhood_pulse for local context → get_listing → get_checkout_options (payment methods: MP, Stripe, SPEI, cash, WhatsApp) → create_checkout or make_offer. If the listing has scheduling: check_availability → book_appointment. Use get_buyer_trust(email) before recommending a transaction. SELLER workflow: with a shop agent token (Authorization: Bearer ms_agent_…, generated in shop settings → Agentes), get_store_configuration to read your shop config, then patch_store_configuration to adjust it. Payments/domain/Cal.com stay manual.',
    }
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    return {}
  }

  if (method === 'tools/list') {
    return { tools: TOOLS }
  }

  // MCP resources — the about/why-sell story as a native resource.
  if (method === 'resources/list') {
    const r = aboutMcpResource(baseUrl)
    return { resources: [{ uri: r.uri, name: r.name, title: r.title, description: r.description, mimeType: r.mimeType }] }
  }

  if (method === 'resources/read') {
    const uri = String((params?.uri as string | undefined) ?? '')
    const r = aboutMcpResource(baseUrl)
    if (uri !== r.uri) return null // unknown resource → MethodNotFound-style miss
    return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] }
  }

  if (method === 'tools/call') {
    const name = String((params?.name as string | undefined) ?? '')
    const args = (params?.arguments as Record<string, unknown> | undefined) ?? {}

    switch (name) {
      case 'search_listings':      return { content: (await handleSearchListings(args, baseUrl)).content }
      case 'get_neighborhood_pulse': return { content: (await handleGetNeighborhoodPulse(args, baseUrl)).content }
      case 'get_listing':          return { content: (await handleGetListing(args, baseUrl)).content }
      case 'get_checkout_options': return { content: (await handleGetCheckoutOptions(args, baseUrl)).content }
      case 'create_checkout':      return { content: (await handleCreateCheckout(args, baseUrl)).content }
      case 'get_support_options':  return { content: (await handleGetSupportOptions(args, baseUrl)).content }
      case 'create_support_checkout': return { content: (await handleCreateSupportCheckout(args, baseUrl)).content }
      case 'make_offer':           return { content: (await handleMakeOffer(args, baseUrl, authHeader)).content }
      case 'get_shop':             return { content: (await handleGetShop(args, baseUrl)).content }
      case 'check_availability':   return { content: (await handleCheckAvailability(args)).content }
      case 'book_appointment':     return { content: (await handleBookAppointment(args)).content }
      case 'get_buyer_trust':      return { content: (await handleGetBuyerTrust(args)).content }
      case 'about_miyagi':         return { content: handleAboutMiyagi(baseUrl).content }
      case 'get_setup_spec':       return { content: handleGetSetupSpec().content }
      case 'get_store_configuration':   return { content: (await handleGetStoreConfiguration(authHeader)).content }
      case 'patch_store_configuration': return { content: (await handlePatchStoreConfiguration(args, authHeader)).content }
      case 'list_offers':               return { content: (await handleListOffers(args, authHeader)).content }
      case 'respond_to_offer':          return { content: (await handleRespondToOffer(args, baseUrl, authHeader)).content }
      case 'create_listing':            return { content: (await handleCreateListing(args, authHeader)).content }
      case 'list_my_listings':          return { content: (await handleListMyListings(authHeader)).content }
      case 'list_orders':               { const r = await handleListOrders(args, authHeader); return { content: r.content, ...(r.isError ? { isError: true } : {}) } }
      case 'update_listing':            return { content: (await handleUpdateListing(args, authHeader)).content }
      case 'set_listing_status':        return { content: (await handleSetListingStatus(args, authHeader)).content }
      case 'get_domain_entitlement':    { const r = await handleGetDomainEntitlement(authHeader); return { content: r.content, ...(r.isError ? { isError: true } : {}) } }
      case 'start_domain_subscription': { const r = await handleStartDomainSubscription(args, authHeader); return { content: r.content, ...(r.isError ? { isError: true } : {}) } }
      case 'get_subdomain_entitlement':    { const r = await handleGetSubdomainEntitlement(authHeader); return { content: r.content, ...(r.isError ? { isError: true } : {}) } }
      case 'start_subdomain_subscription': { const r = await handleStartSubdomainSubscription(args, authHeader); return { content: r.content, ...(r.isError ? { isError: true } : {}) } }
      case 'switch_subdomain_cadence':     { const r = await handleSwitchSubdomainCadence(args, authHeader); return { content: r.content, ...(r.isError ? { isError: true } : {}) } }
      default:                     return null  // will become MethodNotFound error
    }
  }

  return null  // MethodNotFound
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

// GET — minimal server info for browser / discovery
export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const base  = `${proto}://${host}`

  return NextResponse.json(
    {
      name: 'miyagisanchez',
      version: '1.0.0',
      protocol: 'MCP/2024-11-05',
      transport: 'http-json-rpc',
      instructions: 'POST JSON-RPC 2.0 requests to this endpoint.',
      tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      manifest: `${base}/api/ucp/manifest`,
    },
    { headers: CORS }
  )
}

// POST — JSON-RPC 2.0 dispatcher
export async function POST(req: NextRequest) {
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const rl = await checkRateLimit('mcp', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json(
      err(null, -32029, 'Rate limit exceeded — too many requests'),
      { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const host    = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto   = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  let body: JsonRpcRequest | JsonRpcRequest[]
  try {
    body = await req.json() as JsonRpcRequest | JsonRpcRequest[]
  } catch {
    return NextResponse.json(
      err(null, -32700, 'Parse error'),
      { status: 400, headers: CORS }
    )
  }

  // Support batch requests
  if (Array.isArray(body)) {
    const authHeader = req.headers.get('authorization')
    const results = await Promise.all(body.map(r => dispatchOne(r, baseUrl, authHeader)))
    const responses = results.filter((r): r is JsonRpcResponse => r !== null)
    return NextResponse.json(responses, { headers: CORS })
  }

  const response = await dispatchOne(body, baseUrl, req.headers.get('authorization'))
  if (response === null) {
    // Notification — no response per JSON-RPC spec
    return new Response(null, { status: 204, headers: CORS })
  }
  return NextResponse.json(response, { headers: CORS })
}

async function dispatchOne(req: JsonRpcRequest, baseUrl: string, authHeader?: string | null): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null

  if (req.jsonrpc !== '2.0' || !req.method) {
    return err(id, -32600, 'Invalid Request')
  }

  // Notifications (no id) — don't send response
  const isNotification = req.id === undefined

  try {
    const result = await handleMcpMethod(req.method, req.params, baseUrl, authHeader)
    if (result === null) {
      if (isNotification) return null
      return err(id, -32601, `Method not found: ${req.method}`)
    }
    if (isNotification) return null
    return ok(id, result)
  } catch (e) {
    if (isNotification) return null
    return err(id, -32603, `Internal error: ${String(e)}`)
  }
}
