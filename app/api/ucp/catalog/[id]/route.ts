/**
 * GET /api/ucp/catalog/:id
 *
 * Returns full UCP listing detail for a single listing.
 * Used by MCP tool get_listing and any agent doing a deep-dive on a specific item.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { toUcpListing } from '@/lib/ucp/schema'
import type { Listing } from '@/lib/types'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const baseUrl = req.headers.get('origin') ?? 'https://miyagisanchez.com'

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing listing id' }, { status: 400, headers: CORS })
  }

  const { data, error } = await db
    .from('marketplace_listings')
    .select('*, shop:marketplace_shops(id,slug,name,verified,location,clerk_user_id,metadata,mp_enabled)')
    .eq('id', id)
    .eq('status', 'active')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404, headers: CORS })
  }

  return NextResponse.json(
    toUcpListing(data as Listing, baseUrl),
    { headers: CORS }
  )
}
