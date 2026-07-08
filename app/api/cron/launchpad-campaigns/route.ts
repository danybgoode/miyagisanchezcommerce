/**
 * GET /api/cron/launchpad-campaigns — daily close/mint sweep for bookshop-launchpad
 * voting campaigns (S3.3). Closes every ended active campaign (met → mint the
 * product-scoped coupon; unmet → honest close) and re-mints any over-threshold
 * campaign whose vote-route mint didn't land. Idempotent + replay-safe.
 *
 * Auth mirrors the sweepstakes-draw cron: CRON_SECRET (Vercel Cron / manual) or
 * MEDUSA_INTERNAL_SECRET (internal callers). Behind launchpad.enabled.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { runCampaignCloseCron } from '@/lib/launchpad-campaign-automation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  const internalSecret = req.headers.get('x-internal-secret')
  const authz = req.headers.get('authorization')
  const cronOk = !!process.env.CRON_SECRET && (secret === process.env.CRON_SECRET || authz === `Bearer ${process.env.CRON_SECRET}`)
  const internalOk = !!process.env.MEDUSA_INTERNAL_SECRET && internalSecret === process.env.MEDUSA_INTERNAL_SECRET
  if (!cronOk && !internalOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fail-safe: while the feature is dark, the sweep is a no-op (never mints).
  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ ok: true, disabled: true, scanned: 0, met: 0, unmet: 0, errors: 0 })
  }

  try {
    const result = await runCampaignCloseCron()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[launchpad-campaign cron] failed:', e)
    return NextResponse.json({ error: 'close failed' }, { status: 500 })
  }
}
