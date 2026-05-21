/**
 * GET /api/ucp/catalog
 *
 * Public machine-readable catalog for AI agents, MCP clients, and third-party integrations.
 * Returns listings in the UCP format with actions, trust signals, and schema.org markup.
 *
 * Query params:
 *   q            - full-text search (Spanish websearch syntax)
 *   category     - autos | inmuebles | electronica | hogar | moda | deportes | servicios | mascotas | herramientas | negocios | otros
 *   listing_type - product | service | rental | digital
 *   state        - Mexican state name (e.g. "Ciudad de México")
 *   location     - city / neighborhood (partial match)
 *   condition    - new | like_new | good | fair | parts
 *   min_price    - minimum price in MXN pesos (not centavos)
 *   max_price    - maximum price in MXN pesos
 *   limit        - 1–50, default 20
 *   cursor       - ISO timestamp from previous response for pagination
 *   sort         - reciente (default) | precio_asc | precio_desc | popular
 *   brand        - car brand (partial match)
 *   year_from    - car year (>=)
 *   year_to      - car year (<=)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { toUcpListing } from '@/lib/ucp/schema'
import type { Listing } from '@/lib/types'

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

// CORS headers — open to all origins so any AI agent can query
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const origin = req.headers.get('origin') ?? 'https://miyagisanchez.com'
  const baseUrl = origin.startsWith('http') ? origin : 'https://miyagisanchez.com'

  const q           = searchParams.get('q')?.trim()
  const category    = searchParams.get('category')
  const listingType = searchParams.get('listing_type')
  const state       = searchParams.get('state')
  const location    = searchParams.get('location')
  const condition   = searchParams.get('condition')
  const minPrice    = searchParams.get('min_price')
  const maxPrice    = searchParams.get('max_price')
  const cursor      = searchParams.get('cursor')   // ISO timestamp — items older than this
  const sort        = searchParams.get('sort') ?? 'reciente'
  const rawLimit    = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT))
  const limit       = Math.min(Math.max(1, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit), MAX_LIMIT)
  // Automotive filters
  const brand       = searchParams.get('brand')
  const yearFrom    = searchParams.get('year_from')
  const yearTo      = searchParams.get('year_to')

  // ── Build query ─────────────────────────────────────────────────────────────
  let query = db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location,clerk_user_id,metadata,mp_enabled)', { count: 'exact' })
    .eq('status', 'active')
    .limit(limit)

  // Full-text search
  if (q) query = query.textSearch('search_vector', q, { type: 'websearch', config: 'spanish' })

  // Filters
  if (category)    query = query.eq('category', category)
  if (listingType) query = query.eq('listing_type', listingType)
  if (state)       query = query.eq('state', state)
  if (location)    query = query.ilike('location', `%${location}%`)
  if (condition)   query = query.eq('condition', condition)
  if (minPrice)    query = query.gte('price_cents', Math.round(parseFloat(minPrice) * 100))
  if (maxPrice)    query = query.lte('price_cents', Math.round(parseFloat(maxPrice) * 100))
  if (brand)       query = query.ilike('metadata->>brand', `%${brand}%`)
  if (yearFrom)    query = query.gte('metadata->>year', yearFrom)
  if (yearTo)      query = query.lte('metadata->>year', yearTo)

  // Cursor-based pagination (always by created_at)
  if (cursor) {
    query = query.lt('created_at', cursor)
  }

  // Sort
  const orderMap: Record<string, { column: string; ascending: boolean }> = {
    reciente:    { column: 'created_at', ascending: false },
    precio_asc:  { column: 'price_cents', ascending: true },
    precio_desc: { column: 'price_cents', ascending: false },
    popular:     { column: 'views', ascending: false },
  }
  const { column: orderCol, ascending: orderAsc } = orderMap[sort] ?? orderMap.reciente
  query = query.order(orderCol, { ascending: orderAsc })

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json(
      { error: 'Query failed', detail: error.message },
      { status: 500, headers: CORS }
    )
  }

  const listings = (data ?? []) as Listing[]
  const items = listings.map(l => toUcpListing(l, baseUrl))

  // Next cursor = created_at of last item
  const lastItem = listings[listings.length - 1]
  const nextCursor = listings.length === limit && lastItem ? lastItem.created_at : null

  return NextResponse.json(
    {
      items,
      total: count ?? 0,
      limit,
      cursor: nextCursor,
      _meta: {
        api: 'miyagisanchez-ucp',
        version: '1.0',
        docs: `${baseUrl}/api/ucp/manifest`,
      },
    },
    { headers: CORS }
  )
}
