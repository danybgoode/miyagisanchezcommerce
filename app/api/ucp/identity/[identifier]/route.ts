/**
 * GET /api/ucp/identity/:identifier
 *
 * Returns OmniReputation trust score for a buyer.
 * :identifier can be an email address or a Clerk user ID (user_xxx).
 *
 * Used by:
 *  - Sellers evaluating incoming offers
 *  - MCP agents checking buyer trustworthiness before recommending a transaction
 *  - Listing pages showing "Verified buyer" badges (future)
 *
 * Privacy: only score + level + signals are returned (no PII beyond the identifier).
 */

import { NextRequest, NextResponse } from 'next/server'
import { computeTrustScore } from '@/lib/ucp/identity'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60', // 5-min cache
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const decoded = decodeURIComponent(identifier).trim()

  if (!decoded) {
    return NextResponse.json({ error: 'identifier is required' }, { status: 400, headers: CORS })
  }

  // Basic validation — must be an email or Clerk user ID
  const isClerkId = decoded.startsWith('user_')
  const isEmail   = !isClerkId && decoded.includes('@')
  if (!isClerkId && !isEmail) {
    return NextResponse.json(
      { error: 'identifier must be an email address or Clerk user ID (user_xxx)' },
      { status: 400, headers: CORS }
    )
  }

  const score = await computeTrustScore(decoded)
  return NextResponse.json(score, { headers: CORS })
}
