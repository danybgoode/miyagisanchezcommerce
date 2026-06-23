import SupplyClient from './SupplyClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Importar oferta — Admin' }

/**
 * Gem → Medusa supply import, re-homed under the admin shell (was top-level
 * `/supply`). **Dual-accept** this sprint: a Clerk admin (so the shell nav
 * works) OR the legacy `?secret=<ADMIN_SECRET>`. The secret path retires in S2.3.
 */
export default async function AdminSupplyPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  await requireAdmin({ secret })
  return <SupplyClient secret={secret ?? ''} />
}
