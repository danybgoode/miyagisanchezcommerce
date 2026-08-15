/**
 * POST /api/admin/tenants/:id/status — pause, reactivate or remove a shop
 * (tenant-lifecycle-admin · S3.3).
 *
 * Clerk-admin gated by `withAdmin`, which 401s before this handler runs and writes an
 * `admin_audit_log` row on success for free.
 *
 * ── THE WRITE GOES THROUGH MEDUSA (D8) ────────────────────────────────────────
 * This route validates, then calls the backend's internal status route, which owns
 * every decision about what to unlink, what to replay and whether the transition is
 * legal. It never writes `marketplace_shops` first and reconciles later — the mirror
 * is refreshed FROM Medusa, so the directory stays a strict read-model over canonical
 * seller ids.
 *
 * ── AN INCOMPLETE OUTCOME IS REPORTED AS INCOMPLETE ───────────────────────────
 * When a reactivation cannot replay everything it recorded, the backend says
 * `complete: false` and this route passes that through with the affected product ids.
 * Reporting "listo" over a partial restore is the report-must-match-what-happened
 * failure, four instances of which this codebase has already paid for.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { medusaSellerIdOf } from '@/lib/admin/tenant-directory'
import { decideStatusChange } from '@/lib/admin/tenant-actions'
import { changeSellerStatus } from '@/lib/admin/tenant-status'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withAdmin<NextRequest, RouteCtx>(async (req, { params }) => {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // DECIDE FIRST — nothing below has written anything yet.
  const decision = decideStatusChange(body)
  if (!decision.ok) {
    return NextResponse.json({ error: decision.message, field: decision.field }, { status: decision.status })
  }

  const { data: shop, error } = await db
    .from('marketplace_shops')
    .select('id, name, metadata')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: 'No se pudo leer la tienda.' }, { status: 503 })
  }
  if (!shop) {
    return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
  }

  const medusaSellerId = medusaSellerIdOf((shop as { metadata?: unknown }).metadata)
  if (!medusaSellerId) {
    // An un-imported scraped gem has no Medusa seller, so there is no lifecycle to
    // change. Said plainly rather than 500ing on a null id.
    return NextResponse.json(
      { error: 'Esta tienda todavía no existe en Medusa, así que no tiene estado que cambiar.' },
      { status: 409 },
    )
  }

  const result = await changeSellerStatus({
    medusaSellerId,
    status: decision.status,
    reason: decision.reason,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({
    ok: true,
    from: result.from,
    to: result.to,
    unlinked: result.unlinked,
    restored: result.restored,
    missing_products: result.missingProducts,
    // Passed through verbatim. A partial restore must never render as "listo".
    complete: result.complete,
  })
})
