import VecindarioAdminClient from './VecindarioAdminClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Vecindario Sánchez — Admin' }

/**
 * Vecindario Sánchez community-feed moderation, extracted from the Print admin's
 * social tab into its own section (S2.2). **Clerk-gated.**
 */
export default async function VecindarioAdminPage() {
  await requireAdmin()
  return <VecindarioAdminClient />
}
