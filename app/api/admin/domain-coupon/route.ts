/**
 * Admin management for the custom-domain campaign coupon `miyagisan` (epic 07 ·
 * custom-domain-paywall, Sprint 3). Clerk admin-gated via withAdmin.
 *
 *   GET  /api/admin/domain-coupon   — live status (n/100 redemptions)
 *   POST /api/admin/domain-coupon   — mint (idempotent find-or-create)
 *
 * The coupon is a Stripe Coupon + Promotion Code on the platform account; minting
 * runs server-side with prod Stripe creds, so this is the safe mint path (no local
 * key juggling). See lib/domain-coupon-server.ts.
 */
import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import {
  ensureCampaignCoupon,
  getCampaignCouponStatus,
  describeCouponError,
} from '@/lib/domain-coupon-server'

export const dynamic = 'force-dynamic'

export const GET = withAdmin(async () => {
  try {
    const status = await getCampaignCouponStatus()
    return NextResponse.json({ status })
  } catch (e) {
    console.error('[admin/domain-coupon] status failed:', e)
    // Surface the real (sanitized) Stripe cause — a missing/wrong-mode/restricted
    // key can no longer hide behind "no se pudo leer". Never echoes the key.
    const { message, kind, detail } = describeCouponError(e)
    return NextResponse.json({ error: message, kind, detail }, { status: 502 })
  }
})

export const POST = withAdmin(async () => {
  try {
    const status = await ensureCampaignCoupon()
    return NextResponse.json({ status })
  } catch (e) {
    console.error('[admin/domain-coupon] mint failed:', e)
    const { message, kind, detail } = describeCouponError(e)
    return NextResponse.json({ error: message, kind, detail }, { status: 502 })
  }
})
