import AdminCouponsClient, { type Coupon } from './AdminCouponsClient'
import { getReferralSettings } from '@/lib/referrals'
import { getCampaignCouponStatus, type CampaignCouponStatus } from '@/lib/domain-coupon-server'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Cupones de plataforma — Admin' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/**
 * Admin console for platform coupons (codes redeemable on print-ad checkout).
 * **Clerk-gated.** (Referral config now has its own /admin/referrals screen.)
 */
export default async function AdminCouponsPage() {
  await requireAdmin()

  let initialCoupons: Coupon[] = []
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/platform-coupons`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      initialCoupons = data.coupons ?? []
    }
  } catch {
    // Non-fatal — the client can refresh.
  }

  const initialSettings = await getReferralSettings()

  // Campaign coupon (custom-domain paywall S3) — live n/100 status, best-effort.
  let initialCampaign: CampaignCouponStatus | null = null
  try {
    initialCampaign = await getCampaignCouponStatus()
  } catch {
    // Non-fatal — the client can mint / refresh.
  }

  return (
    <AdminCouponsClient
      initialCoupons={initialCoupons}
      initialSettings={initialSettings}
      initialCampaign={initialCampaign}
    />
  )
}
