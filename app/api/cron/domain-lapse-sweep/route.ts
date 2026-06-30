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

// Vercel calls with Authorization: Bearer <CRON_SECRET>. This endpoint is
// DESTRUCTIVE (it disconnects expired domains), so unlike the read-ish crons it
// fails CLOSED in production when CRON_SECRET is unset — a missing env var must
// never turn it into a public teardown endpoint. Locally (no secret) it's open.
function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { released } = await sweepExpiredOneTimeGrants()
  return NextResponse.json({ ok: true, released })
}
