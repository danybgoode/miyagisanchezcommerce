/**
 * GET /api/cron/merchant-lifecycle-sweep
 *
 * Golden Beans event-destination-router · Story 3.1 — daily sweep that emits the two
 * THRESHOLD milestones (`merchant.three_products_live`, `merchant.retained_30d`) to
 * Golden Beans. See lib/merchant-lifecycle-sweep.ts for why these are derived from
 * state rather than hooked at a write site.
 *
 * Idempotent by construction: every emission is claimed under a unique constraint, so
 * a double-fire, a re-run or a manual invocation is a no-op. That matters here — this
 * repo has an open "cron single-fire" question after the GCP migration, and this route
 * is deliberately built so the answer does not change its correctness.
 *
 * Authorized like the other crons (CRON_SECRET). Read-ish rather than destructive — it
 * emits telemetry, it does not tear anything down — so it follows the same posture as
 * the reconcile crons: open locally, closed in production.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sweepMerchantLifecycle } from '@/lib/merchant-lifecycle-sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await sweepMerchantLifecycle()
  // `ok` reflects whether the run was COMPLETE, not merely whether it returned. A run
  // that swallowed read failures or stopped at the candidate cap did partial work, and
  // reporting 200 {ok:true} for it is how a silently-broken cron survives for months.
  const complete = result.errors === 0 && !result.truncated
  return NextResponse.json({ ok: complete, ...result }, { status: complete ? 200 : 207 })
}
