/**
 * POST /api/promoter/relationship/[id]/task/[taskId]/complete — complete a
 * next action (founding-merchant-activation-ops S2.2). Writes `completed_at`
 * (+ `completed_by`); NEVER deletes the row (build contract: "completing a
 * task writes completed_at and never deletes").
 *
 * The task must belong to THIS `id` — the update predicate includes
 * `relationship_id = id`, so a `taskId` that exists but belongs to a
 * DIFFERENT relationship the caller can't see never completes (it just
 * matches zero rows), never leaking whether that other task exists.
 *
 * Idempotent: completing an already-completed task is a no-op success (the
 * `WHERE completed_at IS NULL` predicate matches nothing, so the ORIGINAL
 * `completed_at`/`completed_by` are preserved) rather than an error — a
 * double-tap on a slow connection must never look like a failure or silently
 * overwrite who actually completed it first.
 *
 * Scope-checked through the ONE shared helper (`resolveRelationshipAccess`);
 * a `viewer` partner-grant may READ but not WRITE (`canWriteRelationship`).
 * Gated by `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { authorizeRelationshipRequest, resolveRelationshipAccess, canWriteRelationship } from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id, taskId } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Tu acceso a este registro es de solo lectura (viewer) — completar una acción requiere el rol manager.',
      },
      { status: 403 },
    )
  }

  // Attempt the write first — only ever succeeds while still open.
  const { error: updateError } = await db
    .from('merchant_relationship_tasks')
    .update({ completed_at: new Date().toISOString(), completed_by: auth.user.id })
    .eq('id', taskId)
    .eq('relationship_id', id)
    .is('completed_at', null)

  if (updateError) {
    return NextResponse.json({ ok: false, error: 'No se pudo completar la acción.' }, { status: 500 })
  }

  // Re-read regardless of whether the update matched a row — this is the
  // idempotent branch (already completed) OR the just-written state, and the
  // caller always gets the CURRENT truth either way.
  const { data, error: readError } = await db
    .from('merchant_relationship_tasks')
    .select('id, relationship_id, title, due_at, assigned_to, completed_at, completed_by, created_by, created_at')
    .eq('id', taskId)
    .eq('relationship_id', id)
    .maybeSingle()

  if (readError || !data) {
    return NextResponse.json({ ok: false, error: 'Acción no encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, task: data })
}
