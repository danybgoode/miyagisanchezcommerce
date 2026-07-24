import { notFound } from 'next/navigation'
import { isEnabled } from '@/lib/flags'
import { requireAdmin } from '@/lib/admin/guard'
import AdminConciliacionClient from './AdminConciliacionClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliación — Comercios fundadores' }

/**
 * Admin reconciliation view (founding-merchant-activation-ops S3.3): for
 * every relationship, the source commerce fact, the projected stage, when it
 * was last evaluated, and its Golden Beans delivery state — plus a per-row
 * "reevaluar" action. Thin screen over `GET /api/admin/relationships/
 * reconciliation` + `POST /api/admin/relationship/[id]/replay`.
 * `promoter.activation_crm_enabled`-gated (404 with the flag off) THEN
 * Clerk-admin-gated, matching every sibling `/admin/relaciones*` page.
 */
export default async function AdminConciliacionPage() {
  if (!(await isEnabled('promoter.activation_crm_enabled'))) notFound()
  await requireAdmin()

  return <AdminConciliacionClient />
}
