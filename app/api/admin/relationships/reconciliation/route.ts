/**
 * GET /api/admin/relationships/reconciliation — the full founding-merchant
 * cohort's source fact / projected stage / last-evaluation / delivery state
 * (founding-merchant-activation-ops S3.3). ADMIN ONLY, same gating order as
 * every other `/api/admin/relationship*` route: `promoter.activation_crm_enabled`
 * FIRST (404 when OFF, via `authorizeRelationshipRequest`), then narrowed to
 * admin. Powers `/admin/relaciones/conciliacion`.
 *
 * READ-ONLY — see `lib/relationship-reconciliation.ts`'s header for the
 * no-mutation guarantee this route inherits.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authorizeRelationshipRequest } from '@/lib/relationship-access'
import { loadReconciliationRows } from '@/lib/relationship-reconciliation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error
  if (!auth.actor.isAdmin) {
    return NextResponse.json({ ok: false, error: 'Solo administradores.' }, { status: 403 })
  }

  const rows = await loadReconciliationRows()
  return NextResponse.json({ ok: true, rows })
}
