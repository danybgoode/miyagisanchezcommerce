/**
 * Vercel Cron — daily one-time custom-domain expiry sweep (epic 08 · promoter-program S2).
 *
 * A `one_time` domain grant lapses ON READ (the entitlement gate closes the moment
 * `now >= expires_at`, with no auto-charge), but there is no Stripe webhook at year
 * end to do the physical teardown — so this sweep disconnects the domains whose
 * dated grant has expired (Vercel remove + Supabase null + the lapse prompt), reusing
 * the SAME `releaseCustomDomainForShop` the recurring-cancel webhook uses.
 *
 * Idempotent: a shop with no live domain is skipped, and the release nulls the
 * domain so a re-run is a no-op. Authorized like the other crons (CRON_SECRET).
 */
import { NextRequest, NextResponse } from 'next/server'
import { sweepExpiredOneTimeGrants } from '@/lib/domain-lapse-server'

export const runtime = 'nodejs'

// Vercel calls with Authorization: Bearer <CRON_SECRET>.
function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // allow if not set (local dev)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { released } = await sweepExpiredOneTimeGrants()
  return NextResponse.json({ ok: true, released })
}
