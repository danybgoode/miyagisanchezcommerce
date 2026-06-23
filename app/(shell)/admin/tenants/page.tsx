import AdminTenantsClient from './AdminTenantsClient'
import { requireAdmin } from '@/lib/admin/guard'
import { listTenants } from '@/lib/admin/tenant-directory-server'

export const metadata = { title: 'Tiendas — Admin' }

/**
 * Read-only tenant directory (admin-consolidation · S3.1). Lists every shop
 * (Medusa seller ⋈ `marketplace_shops` mirror) with claim, custom domain,
 * entitlement, and listing count, for search + inspect. **Clerk-gated.**
 * No mutations this sprint — the entitlement grant action lands in S4.
 */
export default async function AdminTenantsPage() {
  await requireAdmin()
  const tenants = await listTenants()
  return <AdminTenantsClient tenants={tenants} />
}
