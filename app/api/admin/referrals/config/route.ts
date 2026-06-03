/**
 * GET   /api/admin/referrals/config?secret=…  — current referral reward settings
 * PATCH /api/admin/referrals/config?secret=…  — update them (no deploy needed)
 *
 * Auth: ?secret=ADMIN_SECRET (matches /api/admin/*).
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkAdminSecret } from '@/lib/print-server'
import { getReferralSettings, updateReferralSettings, type ReferralSettings } from '@/lib/referrals'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const settings = await getReferralSettings()
  return NextResponse.json({ settings })
}

export async function PATCH(req: NextRequest) {
  if (!checkAdminSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Partial<ReferralSettings>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const patch: Partial<ReferralSettings> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (body.reward_type === 'fixed' || body.reward_type === 'percentage') patch.reward_type = body.reward_type
  if (Number.isFinite(body.reward_amount_cents) && (body.reward_amount_cents as number) >= 0) {
    patch.reward_amount_cents = Math.round(body.reward_amount_cents as number)
  }
  if (Number.isFinite(body.reward_expiry_days) && (body.reward_expiry_days as number) > 0) {
    patch.reward_expiry_days = Math.round(body.reward_expiry_days as number)
  }

  const settings = await updateReferralSettings(patch)
  return NextResponse.json({ settings })
}
