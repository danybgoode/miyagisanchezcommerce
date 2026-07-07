/**
 * GET /api/ucp/manifest
 *
 * Machine-readable capability manifest. AI agents and integrators fetch this
 * to understand what the API can do before making catalog or checkout calls.
 *
 * Also serves as the well-known discovery document (link from robots.txt / .well-known).
 */

import { NextRequest, NextResponse } from 'next/server'
import { UCP_CAPABILITIES, MCP_TOOL_NAMES } from '@/lib/ucp/capabilities'
import { aboutManifestBlock } from '@/lib/about-agent'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=3600',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? 'miyagisanchez.com'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const base = `${proto}://${host}`

  return NextResponse.json(
    {
      name: 'miyagisanchez-ucp',
      description: 'Miyagi Sánchez — Universal Commerce Protocol API. A P2P marketplace for Mexico with native AI agent support: browse listings, compare prices, make offers, and complete checkout without leaving your AI interface.',
      version: '1.0',
      base_url: base,
      locale: 'es-MX',
      currency: 'MXN',

      // Canonical capability slugs — single source of truth in lib/ucp/capabilities.ts.
      capabilities: UCP_CAPABILITIES,

      // Supply-side "about / why-sell" answer for prospective sellers, beside the
      // buyer endpoints. Rendered from the single content source (lib/about-content.ts
      // → lib/about-agent.ts); carries the relay-language directive so the reading
      // agent presents it in the user's own language. See the agent-readable about
      // surface epic (07).
      about: aboutManifestBlock(base),

      endpoints: {
        catalog: {
          method: 'GET',
          url: `${base}/api/ucp/catalog`,
          description: 'Search and filter active listings. Supports full-text (Spanish), category, price range, location, condition, and automotive/real-estate metadata filters.',
          auth: 'none',
          params: {
            q:            'Full-text search query (Spanish websearch syntax)',
            category:     'autos | inmuebles | electronica | hogar | moda | deportes | servicios | mascotas | herramientas | negocios | otros',
            listing_type: 'product | service | rental | digital',
            state:        'Mexican state (e.g. "Ciudad de México", "Jalisco")',
            location:     'City or neighborhood (partial match)',
            condition:    'new | like_new | good | fair | parts',
            min_price:    'Minimum price in MXN pesos',
            max_price:    'Maximum price in MXN pesos',
            limit:        '1–50 (default 20)',
            cursor:       'Pagination cursor (created_at of last item from previous response)',
            sort:         'reciente | precio_asc | precio_desc | popular | year_desc | year_asc | marca',
            brand:        'Car marca — alias/casing-aware, e.g. "Volkswagen" also matches "VW" (use with category=autos)',
            model:        'Car modelo (partial match, use with category=autos)',
            year_from:    'Car year minimum (use with category=autos)',
            year_to:      'Car year maximum (use with category=autos)',
            km_from:      'Odometer km minimum (use with category=autos)',
            km_to:        'Odometer km maximum (use with category=autos)',
            transmission: 'automatico | manual | cvt (use with category=autos)',
            fuel:         'gasolina | diesel | hibrido | electrico | gas_lp (use with category=autos)',
          },
        },

        listing_detail: {
          method: 'GET',
          url: `${base}/api/ucp/catalog/{id}`,
          description: 'Get full UCP detail for a single listing including all trust signals, payment methods, and checkout URLs.',
          auth: 'none',
        },

        neighborhood_pulse: {
          method: 'GET',
          url: `${base}/api/ucp/neighborhood-pulse`,
          description: 'Read-only neighborhood pulse: opted-in community items, trending listings, and merchants gaining local attention.',
          auth: 'none',
          params: {
            community_limit: '1–24 community items (default 12)',
            trending_limit: '1–20 trending listings (default 8)',
            shop_limit: '1–12 merchant spotlights (default 6)',
          },
        },

        checkout_mercadopago: {
          method: 'POST',
          url: `${base}/api/mp/checkout`,
          description: 'Create a MercadoPago Checkout Pro session. Redirects buyer to hosted MP page (cards, OXXO, wallet, meses sin intereses). Returns checkoutUrl.',
          auth: 'none',
          body: { listingId: 'string', buyerEmail: 'string (optional)', offerId: 'string (optional — use accepted offer price)' },
        },

        checkout_stripe: {
          method: 'POST',
          url: `${base}/api/stripe/checkout`,
          description: 'Create a Stripe Checkout session for card payments. Returns checkoutUrl.',
          auth: 'none',
          body: { listingId: 'string' },
        },

        support_widget: {
          method: 'GET+POST',
          url: `${base}/api/embed/support`,
          checkout_url: `${base}/api/embed/support/checkout`,
          description: 'Discover a seller support widget by publishable embed key and initiate a guest support contribution with hosted Stripe or Mercado Pago checkout.',
          auth: 'none',
          body: {
            embed_key: 'emb_pk_...',
            amount_cents: 'number — support amount in centavos',
            supporter_email: 'string — required for receipt',
            supporter_name: 'string (optional)',
            message: 'string (optional, max 250 chars)',
            visibility: 'public | private',
            provider: 'stripe | mercadopago',
          },
        },

        make_offer: {
          method: 'POST',
          url: `${base}/api/offers`,
          description: 'Submit a price offer on a listing. Requires an authenticated Miyagi buyer session. Seller will be notified and has 48 hours to accept, counter, or decline.',
          auth: 'clerk_session_or_authorization_header',
          body: {
            listing_id:        'string',
            offer_amount_cents: 'number — offer in centavos (e.g. 150000 = $1,500 MXN)',
            buyer_name:        'string',
            buyer_email:       'string',
            message:           'string (optional)',
          },
        },

        mcp: {
          method: 'GET+POST',
          url: `${base}/api/ucp/mcp`,
          description: 'Model Context Protocol server (HTTP / JSON-RPC 2.0). Connect from Claude Desktop, Gemini, or any MCP-compatible client for native shopping tools plus seller-side configuration tools.',
          auth: 'none',
          mcp_tools: MCP_TOOL_NAMES,
        },

        seller_configuration: {
          method: 'POST',
          url: `${base}/api/ucp/mcp`,
          description: "A seller's own agent can read and adjust its shop configuration via the MCP tools get_store_configuration and patch_store_configuration. Reads the declarative blocks (profile/brand, shipping, negotiation, notifications, orders, returns, scheduling) and patches them with strict validation; never exposes secrets. Payments, custom domain, and Cal.com are OAuth-bound and stay manual.",
          auth: 'authorization_bearer_shop_token',
          note: "Per-shop token (Authorization: Bearer ms_agent_…) generated in the shop's “Agentes e integraciones” settings; scoped to one shop.",
          mcp_tools: ['get_store_configuration', 'patch_store_configuration'],
        },

        seller_orders: {
          method: 'POST',
          url: `${base}/api/ucp/mcp`,
          description: "A seller's own agent can list its own orders across every sales channel — native Miyagi sales and Mercado Libre sales materialized into Medusa (ml-orders-native) — via the MCP tool list_orders. Returns each order's status, buyer, amount, source (miyagi|mercadolibre), tags, and shipment/tracking; filterable by status and source.",
          auth: 'authorization_bearer_shop_token',
          note: "Per-shop token (Authorization: Bearer ms_agent_…) generated in the shop's “Agentes e integraciones” settings; scoped to one shop.",
          mcp_tools: ['list_orders'],
        },

        seller_domain_subscription: {
          method: 'POST',
          url: `${base}/api/ucp/mcp`,
          description: "A seller's own agent can check its custom-domain entitlement and start checkout for the domain SKU (the platform's paid SKU, $499 MXN/yr) via the MCP tools get_domain_entitlement and start_domain_subscription. The SKU has two cadences: `recurring` (annual subscription, default) or `one_time` (pay one year up front with no recurring mandate — a dated 12-month grant that lapses gracefully with no auto-charge). On the recurring cadence pass an optional coupon (e.g. miyagisan) to comp the first year, capped at 100 redemptions. Returns a Stripe checkout URL; entitlement flips on once checkout completes. The free shop URL (/s/slug) stays free; the white-label subdomain is a separate, cheaper SKU (see seller_subdomain_subscription).",
          auth: 'authorization_bearer_shop_token',
          note: "Per-shop token (Authorization: Bearer ms_agent_…) generated in the shop's “Agentes e integraciones” settings; scoped to one shop.",
          mcp_tools: ['get_domain_entitlement', 'start_domain_subscription'],
        },

        seller_subdomain_subscription: {
          method: 'POST',
          url: `${base}/api/ucp/mcp`,
          description: "A seller's own agent can check its subdomain entitlement and start checkout for the subdomain SKU (the platform's cheaper paid SKU, $199 MXN/yr ~ $17/mo, or $25 MXN/mo) via the MCP tools get_subdomain_entitlement and start_subdomain_subscription. This SKU serves the shop white-label at <slug>.miyagisanchez.com as a standalone site (no platform chrome). Two cadences: `recurring` (a subscription, default) or `one_time` (pay one year up front with no recurring mandate — a dated 12-month grant that lapses gracefully with no auto-charge). On the recurring cadence pick the billing interval: `year` ($199/yr, the discount) or `month` ($25/mo); switch between them anytime with switch_subdomain_cadence (Stripe proration, no double charge, no gap). No campaign coupon (that's the custom-domain SKU). Returns a Stripe checkout URL; entitlement flips on once checkout completes. The free shop URL (/s/slug) always stays free.",
          auth: 'authorization_bearer_shop_token',
          note: "Per-shop token (Authorization: Bearer ms_agent_…) generated in the shop's “Agentes e integraciones” settings; scoped to one shop.",
          mcp_tools: ['get_subdomain_entitlement', 'start_subdomain_subscription', 'switch_subdomain_cadence'],
        },

        seller_onboarding: {
          method: 'GET',
          url: `${base}/api/ucp/setup-spec`,
          description: "Onboarding 0 — a prospective seller's own agent reads one published, versioned setup spec + prompt and emits a SINGLE combined setup file (shop profile + store config + catalog) BEFORE the seller signs up. The spec composes the catalog-import and store-config schemas into one shape: { miyagi_setup_version, profile, config, catalog }. The emit prompt is es-MX and instructs the agent to produce all user-facing copy in the seller's own language. Apply path today: the seller signs up and uploads the file via the existing import flow (catalog + settings). Payments, custom domain, and Cal.com stay manual.",
          auth: 'none',
          spec_url: `${base}/api/ucp/setup-spec`,
          docs_url: `${base}/agent`,
          mcp_tools: ['get_setup_spec'],
          note: 'Spec only — the guided first-run apply is coming soon; today, apply by signing up and using the import pages.',
        },
      },

      trust_model: {
        escrow: 'Payment held in Stripe until buyer confirms delivery. Configurable per shop (off / optional / required).',
        verified_sellers: 'Shops with clerk_user_id that have completed identity verification.',
        repuve: 'Mexican vehicle history check. Listings with metadata.repuve contain cryptographic proof of REPUVE lookup.',
        offers: 'All offers are time-bounded (48h seller response, 48h buyer payment window). Auto-expired and cancelled via Resend scheduled emails.',
      },

      schema_org_context: 'https://schema.org',
      openapi_hint: `${base}/api/ucp/manifest`,
    },
    { headers: CORS }
  )
}
