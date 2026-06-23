import { NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { listTenants } from '@/lib/admin/tenant-directory-server'

/**
 * Admin tenant directory — read-only list (admin-consolidation · S3.1).
 * Clerk-gated via `withAdmin` (401 for anyone who isn't a platform admin). GET
 * only → no audit row (`withAdmin` audits mutations). The page renders the same
 * `listTenants()` server-side; this route exists for the auth-gate spec and a
 * client refresh.
 */
export const GET = withAdmin(async () => {
  const tenants = await listTenants()
  return NextResponse.json({ tenants })
})
