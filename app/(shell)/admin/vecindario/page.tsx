import VecindarioAdminClient from './VecindarioAdminClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Vecindario Sánchez — Admin' }

/**
 * Vecindario Sánchez community-feed moderation, extracted from the Print admin's
 * social tab into its own section (S2.2). **Dual-accept** this sprint: a Clerk
 * admin OR the legacy `?secret=<ADMIN_SECRET>`. The secret path retires in S2.3.
 */
export default async function VecindarioAdminPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  await requireAdmin({ secret })
  return <VecindarioAdminClient secret={secret ?? ''} />
}
