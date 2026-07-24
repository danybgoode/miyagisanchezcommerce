import { notFound } from 'next/navigation'
import { isEnabled } from '@/lib/flags'
import { requireAdmin } from '@/lib/admin/guard'
import ActivacionScorecardClient from './ActivacionScorecardClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Activación de comercios fundadores — Admin' }

/**
 * Merchant activation scorecard · Sprint 2, Story 2.1 — the weekly operating
 * view. `promoter.activation_crm_enabled`-gated (404 with the flag off)
 * THEN Clerk-admin-gated, matching `/admin/relaciones`'s exact order (SD2:
 * no new flag for this epic; flag first, so OFF stays byte-identical to
 * "this page doesn't exist" for anyone). Thin screen over
 * `GET /api/admin/scorecard`.
 */
export default async function ActivacionScorecardPage() {
  if (!(await isEnabled('promoter.activation_crm_enabled'))) notFound()
  await requireAdmin()

  return <ActivacionScorecardClient />
}
