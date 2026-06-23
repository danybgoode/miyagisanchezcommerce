import ReferralsAdminClient from './ReferralsAdminClient'
import { getReferralSettings } from '@/lib/referrals'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Referidos — Admin' }

/**
 * Thin admin screen for the referral reward config, over the existing
 * `GET/PATCH /api/admin/referrals/config` (S2.2 — no backend change).
 * **Clerk-gated.**
 */
export default async function AdminReferralsPage() {
  await requireAdmin()
  const initialSettings = await getReferralSettings()
  return <ReferralsAdminClient initialSettings={initialSettings} />
}
