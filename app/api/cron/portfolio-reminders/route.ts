/**
 * GET /api/cron/portfolio-reminders
 *
 * Merchant Partner lifecycle · Sprint 2, Story 2.2 — the periodic steward
 * reminder sweep. Its OWN route, deliberately NOT folded into
 * `/api/cron/merchant-lifecycle-sweep` (build contract): a reminder failure
 * must never be able to degrade the Golden Beans emission drain that route
 * owns. Same `CRON_SECRET` posture as every other cron in this repo (open
 * when unset outside production, closed otherwise) and the same status-code
 * discipline `merchant-lifecycle-sweep` documents: a partial/incomplete run
 * is a 503 (retryable), NEVER a 2xx — a 200 or 207 reads as success to Cloud
 * Scheduler and neither retries nor alerts.
 *
 * Idempotent by construction: every reminder is claimed under
 * `merchant_followup_reminders`'s UNIQUE `(relationship_id, kind, window_key)`
 * constraint (`lib/portfolio/reminders-server.ts`), so a double-fire, a
 * re-run or a manual invocation writes nothing extra for a window already
 * claimed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runPortfolioReminders } from '@/lib/portfolio/reminders-server'

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

  let result: Awaited<ReturnType<typeof runPortfolioReminders>>
  try {
    result = await runPortfolioReminders()
  } catch (err) {
    console.error('[portfolio-reminders] sweep threw:', err)
    return NextResponse.json({ ok: false, error: 'Sweep unavailable' }, { status: 503 })
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 503 })
}
