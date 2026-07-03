import { Suspense } from 'react'
import PrintAdminClient from './PrintAdminClient'
import { requireAdmin } from '@/lib/admin/guard'

export const metadata = { title: 'Edición impresa — Admin' }

/**
 * Admin console for the Print Edition feature, rendered inside the admin shell.
 * **Clerk-gated.**
 */
export default async function PrintAdminPage() {
  await requireAdmin()
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto px-4 py-8">Cargando...</div>}>
      <PrintAdminClient />
    </Suspense>
  )
}
