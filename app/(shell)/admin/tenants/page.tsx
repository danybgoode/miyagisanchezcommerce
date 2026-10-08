import AdminTenantsClient from './AdminTenantsClient'
import { requireAdmin } from '@/lib/admin/guard'
import { readTenantDirectory } from '@/lib/admin/tenant-directory-server'

export const metadata = { title: 'Tiendas — Admin' }

/**
 * Read-only tenant directory (admin-consolidation · S3.1). Lists every shop
 * (Medusa seller ⋈ `marketplace_shops` mirror) with claim, custom domain,
 * entitlement, and listing count, for search + inspect. **Clerk-gated.**
 * No mutations this sprint — the entitlement grant action lands in S4.
 */
export default async function AdminTenantsPage() {
  await requireAdmin()
  const directory = await readTenantDirectory()
  if (directory.state === 'unavailable') {
    return <div role="alert" className="mx-auto max-w-5xl px-4 py-8 text-sm">
      No pudimos cargar el directorio de tiendas. Actualiza la página para intentarlo de nuevo.
    </div>
  }
  return <AdminTenantsClient tenants={directory.rows} />
}
