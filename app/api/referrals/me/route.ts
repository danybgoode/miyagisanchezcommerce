/**
 * GET /api/referrals/me — the signed-in user's referral code + stats.
 * Used by the "Mis referidos" page to refresh after actions.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getOrCreateReferralCode, getReferralStats } from '@/lib/referrals'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const [code, stats] = await Promise.all([
    getOrCreateReferralCode(userId),
    getReferralStats(userId),
  ])
  return NextResponse.json({ code, stats })
}
