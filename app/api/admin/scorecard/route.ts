/**
 * GET /api/admin/scorecard — merchant activation scorecard · Sprint 1, Story
 * 1.3. ADMIN-ONLY, read-only. Reuses `authorizeRelationshipRequest`
 * (`lib/relationship-access.ts`) — the SAME flag-first-then-admin gate every
 * `/api/admin/relationship*` route already applies (SD2: no new flag; flag
 * `promoter.activation_crm_enabled` OFF ⇒ 404, indistinguishable from
 * absent). Delegates to `lib/scorecard/loader.ts#loadScorecard` — the ONE
 * loader → resolver pair the UI (Story 2.1), the CSV export (Story 2.2) and
 * the agent tool (Story 2.3) all call identically (decision 2).
 *
 * Only GET is exported — there is no write method on this route at all.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest } from '@/lib/relationship-access'
import { loadScorecard } from '@/lib/scorecard/loader'
import type { ScorecardFilters } from '@/lib/scorecard/types'

export const dynamic = 'force-dynamic'

export function parseScorecardFilters(url: URL): ScorecardFilters {
  const sp = url.searchParams
  return {
    cohort: sp.get('cohort') || undefined,
    stage: sp.get('stage') || undefined,
    promoter: sp.get('promoter') || undefined,
    steward: sp.get('steward') || undefined,
    dateFrom: sp.get('date_from') || undefined,
    dateTo: sp.get('date_to') || undefined,
  }
}

export async function GET(req: NextRequest) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error
  if (!auth.actor.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Solo administradores.' }, { status: 403 })
  }

  const filters = parseScorecardFilters(new URL(req.url))
  const result = await loadScorecard(filters)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, scorecard: result.scorecard })
}
