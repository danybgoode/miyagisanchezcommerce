/**
 * Admin management for the custom-domain campaign coupon `miyagisan` (epic 07 ·
 * custom-domain-paywall, Sprint 3). Secret-gated, matching /api/admin/*.
 *
 *   GET  /api/admin/domain-coupon?secret=…   — live status (n/100 redemptions)
 *   POST /api/admin/domain-coupon?secret=…   — mint (idempotent find-or-create)
 *
 * The coupon is a Stripe Coupon + Promotion Code on the platform account; minting
 * runs server-side with prod Stripe creds, so this is the safe mint path (no local
 * key juggling). See lib/domain-coupon-server.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkAdminSecret } from '@/lib/print-server'
import { ensureCampaignCoupon, getCampaignCouponStatus } from '@/lib/domain-coupon-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const status = await getCampaignCouponStatus()
    return NextResponse.json({ status })
  } catch (e) {
    console.error('[admin/domain-coupon] status failed:', e)
    return NextResponse.json({ error: 'No se pudo leer el estado del cupón.' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const status = await ensureCampaignCoupon()
    return NextResponse.json({ status })
  } catch (e) {
    console.error('[admin/domain-coupon] mint failed:', e)
    return NextResponse.json({ error: 'No se pudo crear el cupón.' }, { status: 502 })
  }
}
