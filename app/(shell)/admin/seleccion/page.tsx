import SeleccionAdminClient from './SeleccionAdminClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Selección de la semana — Admin' }

/**
 * Homepage Selección curation (S2.2) — pin/unpin products and order them for the
 * homepage "Selección de la semana". **Clerk-gated.** Writes go through
 * `PATCH /api/admin/seleccion/[id]` → the admin-scoped backend internal route,
 * which sets `metadata.featured` + `metadata.featured_rank` on the Medusa product.
 */
export default async function SeleccionAdminPage() {
  await requireAdmin()
  return <SeleccionAdminClient />
}
