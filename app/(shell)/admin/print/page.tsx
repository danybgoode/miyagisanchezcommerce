import PrintAdminClient from './PrintAdminClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Edición impresa — Admin' }

/**
 * Admin console for the Print Edition feature, rendered inside the admin shell.
 * **Dual-accept** this sprint: a Clerk admin (so the new shell nav works) OR
 * the legacy `?secret=<ADMIN_SECRET>` (so existing access keeps working). The
 * secret path retires in S2.3.
 */
export default async function PrintAdminPage({ searchParams }: { searchParams: Promise<{ secret?: string }> }) {
  const { secret } = await searchParams
  await requireAdmin({ secret })
  return <PrintAdminClient secret={secret ?? ''} />
}
