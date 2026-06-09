/**
 * GET /api/ucp/setup-spec
 *
 * Public, agent-fetchable contract for "Onboarding 0": the single combined setup
 * file (shop profile + store config + catalog) a seller's own AI agent emits BEFORE
 * signup. Returns the versioned schema, both sub-schemas, an example, and the emit
 * prompt — everything an agent needs to act with no human handing it anything.
 *
 * Apply path today: sign up, then use the existing import flow. (A guided first-run
 * apply lands in Sprint 2 — this endpoint does not claim it exists yet.)
 */

import { NextResponse } from 'next/server'
import { buildSetupSpec } from '@/lib/setup-spec'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=3600',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET() {
  return NextResponse.json(buildSetupSpec(), { headers: CORS })
}
