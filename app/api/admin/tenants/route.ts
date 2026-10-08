import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { readTenantDirectory } from '@/lib/admin/tenant-directory-server'

/**
 * Admin tenant directory — read-only list (admin-consolidation · S3.1).
 * Clerk-gated via `withAdmin` (401 for anyone who isn't a platform admin). GET
 * only → no audit row (`withAdmin` audits mutations). The page renders the same
 * `readTenantDirectory()` server-side; this route exists for the auth-gate spec and a
 * client refresh.
 */
export const GET = withAdmin(async () => {
  const directory = await readTenantDirectory()
  if (directory.state === 'unavailable') {
    return NextResponse.json({ error: 'No pudimos cargar el directorio de tiendas.' }, { status: 503 })
  }
  return NextResponse.json({ tenants: directory.rows })
})
