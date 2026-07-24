/**
 * GET /api/admin/scorecard/export — merchant activation scorecard · Sprint
 * 2, Story 2.2. Applies the IDENTICAL resolver, schema version and filters
 * as `GET /api/admin/scorecard` and the operating view (decision 2) —
 * shares `parseScorecardFilters` and `loadScorecard` verbatim, then
 * serializes the SAME `Scorecard` object via `lib/scorecard/csv.ts`. Auth
 * matches the read endpoint exactly (`authorizeRelationshipRequest`, SD2).
 * Contact PII is structurally absent (see `lib/scorecard/csv.ts`'s header).
 *
 * Only GET is exported.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest } from '@/lib/relationship-access'
import { loadScorecard } from '@/lib/scorecard/loader'
import { scorecardToCsv } from '@/lib/scorecard/csv'
import { parseScorecardFilters } from '@/app/api/admin/scorecard/route'

export const dynamic = 'force-dynamic'

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

  const csv = scorecardToCsv(result.scorecard)
  const date = result.scorecard.generatedAt.slice(0, 10)
  const filename = `activacion-comercios-${date}.csv`

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
