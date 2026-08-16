/**
 * PATCH /api/admin/tenants/:id/edit — change a shop's presentation
 * (tenant-lifecycle-admin · S3.3).
 *
 * Clerk-admin gated by `withAdmin` (401s before this runs, audits on success).
 *
 * Name, description and location only. Slug and custom domain are deliberately NOT
 * editable here — the reasoning is in `lib/admin/tenant-actions.ts`, and a request
 * carrying either is refused rather than ignored, so an operator who expected the
 * change to land is told it did not.
 *
 * ── WHY THIS ONE WRITES THE MIRROR ────────────────────────────────────────────
 * D8 says lifecycle writes go through Medusa, because Medusa owns the seller's
 * existence. Presentation is different: `marketplace_shops` is where the storefront
 * reads a shop's display name and blurb from, and the seller portal already edits
 * exactly these three columns there. Writing them here through the same path keeps
 * one writer for one fact — routing presentation through Medusa would create a second
 * one and put the two out of sync.
 */
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin/guard'
import { db } from '@/lib/supabase'
import { decideTenantEdit } from '@/lib/admin/tenant-actions'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const PATCH = withAdmin<NextRequest, RouteCtx>(async (req, { params }) => {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 })
  }

  // DECIDE FIRST — every field validated before a single write.
  const decision = decideTenantEdit(body)
  if (!decision.ok) {
    return NextResponse.json({ error: decision.message, field: decision.field }, { status: decision.status })
  }

  // `.select()` back: supabase-js reports NO error for an UPDATE that matched nothing,
  // so without this a bad id would look like a clean success.
  const { data, error } = await db
    .from('marketplace_shops')
    .update(decision.patch)
    .eq('id', id)
    .select('id, name, description, location')

  if (error) {
    return NextResponse.json({ error: 'No se pudo guardar el cambio.' }, { status: 503 })
  }
  if (!data?.length) {
    return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, shop: data[0] })
})
