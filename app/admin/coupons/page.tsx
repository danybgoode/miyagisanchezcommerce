import { redirect } from 'next/navigation'
import AdminCouponsClient, { type Coupon } from './AdminCouponsClient'

export const metadata = { title: 'Cupones de plataforma — Admin' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/**
 * Secret-gated admin console for platform coupons (codes redeemable on print-ad
 * checkout) and the referral reward config. Auth matches /api/admin/*:
 * ?secret=<ADMIN_SECRET>.
 */
export default async function AdminCouponsPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  if (!secret || secret !== process.env.ADMIN_SECRET) redirect('/')

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

  return <AdminCouponsClient secret={secret} initialCoupons={initialCoupons} />
}
