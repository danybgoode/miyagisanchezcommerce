import PromoterAdminClient from './PromoterAdminClient'
import {
  listPromoters,
  getPromoterSettings,
  getCommissionRates,
  listPendingCommissions,
} from '@/lib/promoter'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Promotores — Admin' }

/**
 * Admin console for the Promoter Program (epic 08). Provision promoters (each gets
 * a stable PRM- code + shareable link), configure the seller discount their code
 * unlocks, set the per-SKU commission % (S3 · US-7), and settle accrued commissions
 * offline (S3 · US-9). Thin screen over `/api/admin/promoter*`. **Clerk-gated.**
 */
export default async function AdminPromoterPage() {
  await requireAdmin()
  const [promoters, settings, commissionRates, pendingCommissions] = await Promise.all([
    listPromoters(),
    getPromoterSettings(),
    getCommissionRates(),
    listPendingCommissions(),
  ])
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  return (
    <PromoterAdminClient
      initialPromoters={promoters}
      initialSettings={settings}
      initialCommissionRates={commissionRates}
      initialPendingCommissions={pendingCommissions}
      siteUrl={siteUrl}
    />
  )
}
