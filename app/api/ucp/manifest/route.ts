/**
 * GET /api/ucp/manifest
 *
 * Machine-readable capability manifest. AI agents and integrators fetch this
 * to understand what the API can do before making catalog or checkout calls.
 *
 * Also serves as the well-known discovery document (link from robots.txt / .well-known).
 */

import { NextRequest, NextResponse } from 'next/server'

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

      capabilities: [
        'catalog_search',       // browse + filter listings
        'listing_detail',       // get single listing with full trust metadata
        'make_offer',           // A2A price negotiation
        'buy_now_mercadopago',  // instant checkout via MercadoPago (cards, OXXO, wallet, MSI)
        'buy_now_stripe',       // instant checkout via Stripe Connect
        'escrow',               // optional/required payment hold until delivery confirmed
        'mcp_server',           // Model Context Protocol — connect via MCP client
      ],

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
            sort:         'reciente | precio_asc | precio_desc | popular',
            brand:        'Car brand (partial match, use with category=autos)',
            year_from:    'Car year minimum (use with category=autos)',
            year_to:      'Car year maximum (use with category=autos)',
          },
        },

        listing_detail: {
          method: 'GET',
          url: `${base}/api/ucp/catalog/{id}`,
          description: 'Get full UCP detail for a single listing including all trust signals, payment methods, and checkout URLs.',
          auth: 'none',
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

        make_offer: {
          method: 'POST',
          url: `${base}/api/offers`,
          description: 'Submit a price offer on a listing. Seller will be notified by email and has 72 hours to accept, counter, or decline.',
          auth: 'none',
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
          description: 'Model Context Protocol server (HTTP/SSE transport). Connect from Claude Desktop, Gemini, or any MCP-compatible client to get native shopping tools: search_listings, get_listing, create_checkout, make_offer, get_shop.',
          auth: 'none',
          mcp_tools: ['search_listings', 'get_listing', 'create_checkout', 'make_offer', 'get_shop'],
        },
      },

      trust_model: {
        escrow: 'Payment held in Stripe until buyer confirms delivery. Configurable per shop (off / optional / required).',
        verified_sellers: 'Shops with clerk_user_id that have completed identity verification.',
        repuve: 'Mexican vehicle history check. Listings with metadata.repuve contain cryptographic proof of REPUVE lookup.',
        offers: 'All offers are time-bounded (72h seller response, 48h buyer payment window). Auto-expired and cancelled via Resend scheduled emails.',
      },

      schema_org_context: 'https://schema.org',
      openapi_hint: `${base}/api/ucp/manifest`,
    },
    { headers: CORS }
  )
}
