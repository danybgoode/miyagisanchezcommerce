import ReferralsAdminClient from './ReferralsAdminClient'
import { getReferralSettings } from '@/lib/referrals'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Referidos — Admin' }

/**
 * Thin admin screen for the referral reward config, over the existing
 * `GET/PATCH /api/admin/referrals/config` (S2.2 — no backend change).
 * **Dual-accept** this sprint: a Clerk admin OR the legacy `?secret=`. Retires in S2.3.
 */
export default async function AdminReferralsPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  await requireAdmin({ secret })
  const initialSettings = await getReferralSettings()
  return <ReferralsAdminClient secret={secret ?? ''} initialSettings={initialSettings} />
}
