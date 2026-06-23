import SupplyClient from './SupplyClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Importar oferta — Admin' }

/**
 * Gem → Medusa supply import, re-homed under the admin shell (was top-level
 * `/supply`). **Clerk-gated.**
 */
export default async function AdminSupplyPage() {
  await requireAdmin()
  return <SupplyClient />
}
