/**
 * GET /api/ucp/catalog
 *
 * Public machine-readable catalog for AI agents, MCP clients, and third-party integrations.
 * Returns listings in the UCP format with actions, trust signals, and schema.org markup.
 * Data source: Medusa headless backend via /store/listings.
 *
 * Query params:
 *   q            - full-text search
 *   category     - autos | inmuebles | electronica | hogar | moda | deportes | servicios | mascotas | herramientas | negocios | otros
 *   listing_type - product | service | rental | digital | subscription
 *   state        - Mexican state name (e.g. "Ciudad de México")
 *   location     - city / neighborhood (partial match)
 *   condition    - new | like_new | good | fair | parts
 *   min_price    - minimum price in MXN pesos (not centavos)
 *   max_price    - maximum price in MXN pesos
 *   limit        - 1–50, default 20
 *   sort         - reciente (default) | precio_asc | precio_desc | popular | year_desc | year_asc | marca
 *   brand        - car marca (alias/casing-aware, e.g. "Volkswagen" also matches "VW")
 *   model        - car modelo (partial match)
 *   year_from    - car year (>=)
 *   year_to      - car year (<=)
 *   km_from      - odometer km (>=)
 *   km_to        - odometer km (<=)
 *   transmission - automatico | manual | cvt
 *   fuel         - gasolina | diesel | hibrido | electrico | gas_lp
 */

import { NextRequest, NextResponse } from 'next/server'
import { toUcpListing } from '@/lib/ucp/schema'
import { isEmbedRequest } from '@/lib/embed-auth'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { CACHE, storefrontCacheControl } from '@/lib/cache-policy'
import { getPriceGrid } from '@/lib/listings'
import type { Listing } from '@/lib/types'

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': storefrontCacheControl(CACHE.CATALOG),
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  // Embed-marked requests (the public widget) are rate-limited; the marketplace
  // and AI agents hitting the same endpoint are not. No-op without Redis.
  if (isEmbedRequest(req)) {
    const rl = await checkRateLimit('embed', getClientIp(req))
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes.' },
        { status: 429, headers: { ...CORS, 'Retry-After': String(rl.retryAfter) } },
      )
    }
  }

  const { searchParams } = new URL(req.url)
  const origin = req.headers.get('origin') ?? 'https://miyagisanchez.com'
  const baseUrl = origin.startsWith('http') ? origin : 'https://miyagisanchez.com'

  const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT))
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit), MAX_LIMIT)

  // Forward all filter params to Medusa /store/listings
  const forwardParams = new URLSearchParams()
  for (const [key, val] of searchParams.entries()) {
    if (val) forwardParams.set(key, val)
  }
  forwardParams.set('limit', String(limit))
  forwardParams.set('sort', searchParams.get('sort') ?? 'reciente')
  // UCP uses min_price/max_price in pesos — Medusa endpoint also takes pesos
  // (the backend multiplies by 100 internally)

  const res = await fetch(`${MEDUSA_BASE}/store/listings?${forwardParams.toString()}`, {
    headers: { 'x-publishable-api-key': PUB_KEY },
    next: { revalidate: CACHE.CATALOG } as RequestInit['next'],
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: 'Catalog unavailable', detail: `Medusa: ${res.status}` },
      { status: 503, headers: CORS }
    )
  }

  const data = await res.json()
  const listings = (data.listings ?? []) as Listing[]
  // Price-grid per item (custom-print-products S4 · 4.2 — exposes configurator
  // options/tiers to agents). `limit` already caps the page, and getPriceGrid
  // is cache-backed, so this stays cheap; null for an ordinary listing.
  const items = await Promise.all(listings.map(async (l: Listing) =>
    toUcpListing(l, baseUrl, await getPriceGrid(l.medusa_product_id ?? l.id))))

  return NextResponse.json(
    {
      items,
      total: data.total ?? 0,
      limit,
      cursor: null,
      _meta: {
        api: 'miyagisanchez-ucp',
        version: '1.0',
        docs: `${baseUrl}/api/ucp/manifest`,
      },
    },
    { headers: CORS }
  )
}
