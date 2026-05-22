/**
 * Vercel Cron — runs daily at 09:00 UTC (03:00 Mexico City)
 *
 * Four cleanup passes:
 *   1. Expire scraped + unclaimed listings older than 90 days
 *   2. Hard-delete long-expired scraped listings (expired > 90 days ago)
 *   3. Prune supply_items staging table (imported/rejected > 30d, pending > 60d)
 *   4. Flag claimed listings with no seller activity in 120 days (gentle)
 *
 * Safe to run multiple times — all operations are idempotent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { tg } from '@/lib/telegram'

export const runtime = 'nodejs'
export const maxDuration = 60  // allow up to 60s — cleanup can be slow

function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stats = { expired: 0, deleted: 0, stagingCleaned: 0, flaggedStale: 0, errors: [] as string[] }

  // ── Pass 1: Expire unclaimed scraped listings older than 90 days ──────────
  try {
    const expiryCutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
    const { data: toExpire } = await db
      .from('marketplace_listings')
      .select('id')
      .eq('status', 'active')
      .eq('source', 'scraped')
      .lt('created_at', expiryCutoff)
      // Only unclaimed shops (clerk_user_id IS NULL — join via shop)
      // We filter via metadata flag set at import time
      .filter('metadata->>supply', 'not.is', null)

    if (toExpire && toExpire.length > 0) {
      const ids = toExpire.map(r => r.id)
      await db
        .from('marketplace_listings')
        .update({ status: 'expired' })
        .in('id', ids)
      stats.expired = ids.length
    }
  } catch (e) {
    stats.errors.push(`pass1: ${String(e)}`)
  }

  // ── Pass 2: Hard-delete scraped listings expired more than 90 days ago ────
  try {
    const deleteCutoff = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString()
    const { data: toDelete } = await db
      .from('marketplace_listings')
      .select('id')
      .eq('status', 'expired')
      .eq('source', 'scraped')
      .lt('updated_at', deleteCutoff)

    if (toDelete && toDelete.length > 0) {
      const ids = toDelete.map(r => r.id)
      await db.from('marketplace_listings').delete().in('id', ids)
      stats.deleted = ids.length
    }
  } catch (e) {
    stats.errors.push(`pass2: ${String(e)}`)
  }

  // ── Pass 3: Prune supply_items staging table ───────────────────────────────
  try {
    // Delete finalized items (imported/rejected) older than 30 days
    const finalCutoff  = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    const pendingCutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString()

    const [finalResult, pendingResult] = await Promise.all([
      db.from('supply_items')
        .delete()
        .in('status', ['imported', 'rejected'])
        .lt('updated_at', finalCutoff),
      db.from('supply_items')
        .delete()
        .eq('status', 'pending_review')
        .lt('created_at', pendingCutoff),
    ])

    const finalCount   = finalResult.count ?? 0
    const pendingCount = pendingResult.count ?? 0
    stats.stagingCleaned = finalCount + pendingCount
  } catch (e) {
    stats.errors.push(`pass3: ${String(e)}`)
  }

  // ── Pass 4: Flag stale claimed listings for seller review ─────────────────
  // Only flags; does NOT expire — sellers get an email separately
  try {
    const staleCutoff = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString()
    const { data: staleListings } = await db
      .from('marketplace_listings')
      .select('id, title, shop:marketplace_shops!inner(clerk_user_id)')
      .eq('status', 'active')
      .eq('source', 'scraped')
      .lt('updated_at', staleCutoff)
      // Only claimed (has a real seller)
      .not('shop.clerk_user_id', 'is', null)
      .limit(50)  // process max 50 per run to avoid timeouts

    if (staleListings && staleListings.length > 0) {
      stats.flaggedStale = staleListings.length
      // TODO Sprint 2: send "Is this still available?" email to each seller
      // For now, just count them so we know the scope
    }
  } catch (e) {
    stats.errors.push(`pass4: ${String(e)}`)
  }

  // ── Telegram summary ───────────────────────────────────────────────────────
  await tg.cleanupRun(stats.expired, stats.deleted, stats.stagingCleaned)

  if (stats.errors.length > 0) {
    await tg.alert(`Cleanup cron errors:\n${stats.errors.join('\n')}`)
  }

  return NextResponse.json({
    ok: true,
    stats,
    ran_at: new Date().toISOString(),
  })
}
