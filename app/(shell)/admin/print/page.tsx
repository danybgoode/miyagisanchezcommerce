import PrintAdminClient from './PrintAdminClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Edición impresa — Admin' }

/**
 * Admin console for the Print Edition feature, rendered inside the admin shell.
 * **Clerk-gated.**
 */
export default async function PrintAdminPage() {
  await requireAdmin()
  return <PrintAdminClient />
}
