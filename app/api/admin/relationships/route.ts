/**
 * GET /api/admin/relationships — the full founding-merchant cohort, ADMIN
 * ONLY (founding-merchant-activation-ops S2.3). Column-level filters
 * (`stage`, `steward`) push down to SQL via `lib/relationship-list.ts`;
 * `blocker`, `missing_action` and `overdue` are computed per-row by
 * `lib/relationship-enrich.ts` (they need the joined open-tasks read) and
 * applied as an in-memory filter afterward. Powers `/admin/relaciones`.
 *
 * Gated by `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`), then narrowed to admin explicitly — this
 * is the FULL cohort across every promoter, never scoped by grant.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest } from '@/lib/relationship-access'
import { listAllRelationships } from '@/lib/relationship-list'
import { enrichRelationships, type EnrichedRelationship } from '@/lib/relationship-enrich'

export const dynamic = 'force-dynamic'

function parseTriState(value: string | null): boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

export async function GET(req: NextRequest) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error
  if (!auth.actor.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Solo administradores.' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const stage = searchParams.get('stage') || undefined
  const steward = searchParams.get('steward') || undefined
  const blocker = parseTriState(searchParams.get('blocker'))
  const missingAction = parseTriState(searchParams.get('missing_action'))
  const overdue = parseTriState(searchParams.get('overdue'))

  const rows = await listAllRelationships({ stage, steward })
  let relationships: EnrichedRelationship[] = await enrichRelationships(rows, new Date())

  if (blocker !== null) relationships = relationships.filter((r) => r.blocker === blocker)
  if (missingAction !== null) relationships = relationships.filter((r) => r.missingAction === missingAction)
  if (overdue !== null) relationships = relationships.filter((r) => r.overdue === overdue)

  return NextResponse.json({ ok: true, relationships })
}
