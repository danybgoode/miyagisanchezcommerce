import AdminCouponsClient, { type Coupon } from './AdminCouponsClient'
import { getReferralSettings } from '@/lib/referrals'
import { getCampaignCouponStatus, type CampaignCouponStatus } from '@/lib/domain-coupon-server'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Cupones de plataforma — Admin' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/**
 * Admin console for platform coupons (codes redeemable on print-ad checkout)
 * and the referral reward config. **Dual-accept** this sprint: a Clerk admin
 * (so the new shell nav works) OR the legacy `?secret=<ADMIN_SECRET>` (so
 * existing access keeps working). The secret path retires in S2.3.
 */
export default async function AdminCouponsPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  await requireAdmin({ secret })

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
      secret={secret ?? ''}
      initialCoupons={initialCoupons}
      initialSettings={initialSettings}
      initialCampaign={initialCampaign}
    />
  )
}
