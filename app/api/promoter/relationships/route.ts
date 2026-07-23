/**
 * GET /api/promoter/relationships — the promoter operating pipeline
 * (founding-merchant-activation-ops S2.3): the caller's OWNED + GRANTED
 * relationships, enriched with stage age, next action (or the missing-action
 * warning), overdue and consent state. Powers `/promotor/relaciones`.
 *
 * Scope is `lib/relationship-list.ts#listScopedRelationships` — the LIST
 * sibling of `resolveRelationshipAccess`'s per-id rule (same three
 * populations: owner `promoter_id`, active `partner_grants`, admin). Gated by
 * `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest } from '@/lib/relationship-access'
import { listScopedRelationships } from '@/lib/relationship-list'
import { enrichRelationships } from '@/lib/relationship-enrich'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const rows = await listScopedRelationships(auth.actor)
  const relationships = await enrichRelationships(rows, new Date())

  return NextResponse.json({ ok: true, relationships })
}
