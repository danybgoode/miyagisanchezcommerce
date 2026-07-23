import { notFound } from 'next/navigation'
import { isEnabled } from '@/lib/flags'
import { requireAdmin } from '@/lib/admin/guard'
import AdminRelacionesClient from './AdminRelacionesClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comercios fundadores — Admin' }

/**
 * Admin cohort view (founding-merchant-activation-ops S2.3): every founding-
 * merchant relationship, filterable by stage/steward/blocker/missing-action/
 * overdue, with the stage-correction tool (the sprint's one write onto
 * `merchant_relationship_transitions`, D3). Thin screen over
 * `GET /api/admin/relationships` + `POST /api/admin/relationship/[id]/correct-stage`.
 * `promoter.activation_crm_enabled`-gated (404 with the flag off) THEN
 * Clerk-admin-gated, matching every other `/api/admin/relationship*` route's
 * order (flag first, so OFF stays byte-identical to "this page doesn't
 * exist" for anyone, admin or not).
 */
export default async function AdminRelacionesPage() {
  if (!(await isEnabled('promoter.activation_crm_enabled'))) notFound()
  await requireAdmin()

  return <AdminRelacionesClient />
}
