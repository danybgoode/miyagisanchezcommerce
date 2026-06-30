import PromoterAdminClient from './PromoterAdminClient'
import { listPromoters, getPromoterSettings } from '@/lib/promoter'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Promotores — Admin' }

/**
 * Admin console for the Promoter Program (epic 08). Provision promoters (each gets
 * a stable PRM- code + shareable link) and configure the seller discount their code
 * unlocks. Thin screen over `GET/POST/PATCH /api/admin/promoter`. **Clerk-gated.**
 */
export default async function AdminPromoterPage() {
  await requireAdmin()
  const [promoters, settings] = await Promise.all([listPromoters(), getPromoterSettings()])
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'
  return <PromoterAdminClient initialPromoters={promoters} initialSettings={settings} siteUrl={siteUrl} />
}
