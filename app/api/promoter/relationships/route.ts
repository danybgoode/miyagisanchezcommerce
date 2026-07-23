/**
 * GET /api/promoter/relationships — the promoter operating pipeline
 * (founding-merchant-activation-ops S2.3): the caller's OWNED + STEWARDED +
 * GRANTED relationships, enriched with stage age, next action (or the
 * missing-action warning), overdue and consent state. Powers
 * `/promotor/relaciones`.
 *
 * Scope is `lib/relationship-list.ts#listScopedRelationships` — the LIST
 * sibling of `resolveRelationshipAccess`'s per-id rule (same four
 * populations: owner `promoter_id`, steward, active `partner_grants`, admin).
 * Gated by `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`).
 *
 * C3 fix (PR 304 review): both the list read and the enrichment read can now
 * fail closed — `{ ok: false }` from either becomes a 500 here, never a
 * silently-empty or silently-wrong 200.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest } from '@/lib/relationship-access'
import { listScopedRelationships } from '@/lib/relationship-list'
import { enrichRelationships } from '@/lib/relationship-enrich'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const listResult = await listScopedRelationships(auth.actor)
  if (!listResult.ok) {
    return NextResponse.json({ ok: false, error: 'No se pudo leer tu cartera de comercios.' }, { status: 500 })
  }

  const enrichResult = await enrichRelationships(listResult.rows, new Date())
  if (!enrichResult.ok) {
    return NextResponse.json({ ok: false, error: 'No se pudo calcular el resumen de tu cartera.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, relationships: enrichResult.relationships })
}
