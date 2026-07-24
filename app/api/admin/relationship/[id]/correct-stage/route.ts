/**
 * POST /api/admin/relationship/[id]/correct-stage — the ONE write path onto
 * `merchant_relationship_transitions` this sprint (README D3: "stage is
 * DERIVED, corrections are the only writes"). ADMIN ONLY. Writes an
 * immutable transition row (`actor_type='admin'`, `dedupe_key =
 * 'correction:<uuid>'` — always unique, so it never collides with a prior
 * correction or a future derived advance) and mirrors the new stage onto
 * `merchant_relationships.stage`/`stage_entered_at` so the operating views
 * read the corrected truth. NEVER deletes the row it corrects — prior
 * transition history stays exactly as it was.
 *
 * `reason` is REQUIRED — enforced HERE (422 without it, build contract) AND
 * independently by the migration's `CHECK (dedupe_key NOT LIKE
 * 'correction:%' OR reason IS NOT NULL)`, so no future writer of this table
 * can skip it by going around this route.
 *
 * C9 fix (PR 304 review): `reason` is now runtime type-checked (400 for a
 * non-string, distinct from 422 for a missing/blank one) BEFORE `.trim()`
 * touches it — `{reason: 123}` used to 500.
 *
 * D3d fix (PR 304 review, round 3): the mirror UPDATE is now a
 * COMPARE-AND-SET on `stage = fromStage` (the stage THIS request read).
 * Without it, two admins reading the same `scouted` row and racing
 * corrections to `qualified` and `claimed` could land the UPDATEs in the
 * OPPOSITE order from the TRANSITION inserts (which have no such ordering
 * guarantee against each other either) — the mirror would then show
 * `qualified` while the LATEST transition row says `claimed`, disagreeing
 * with its own audit trail. The CAS predicate means a losing writer's
 * UPDATE matches zero rows (Supabase's `.maybeSingle()` returns `{data:
 * null, error: null}` for that, not an error) rather than clobbering a
 * newer stage — reported as `stageMirrorUpdated: false`, which the client
 * already surfaces (C4). The TRANSITION row is unconditionally committed
 * either way — it stays the audit truth regardless of who wins the mirror.
 *
 * Scope-checked through the ONE shared helper (`resolveRelationshipAccess`),
 * then narrowed to `role === 'admin'` explicitly — an owner/manager grant
 * passes the shared check but must NOT be able to correct a stage (that's an
 * admin action, not a stewardship one). Gated by
 * `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest` — the shared gate applies to every
 * relationship route regardless of its `/api/admin` vs `/api/promoter`
 * prefix).
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { authorizeRelationshipRequest, resolveRelationshipAccess, toRelationshipDTO, type RelationshipRow } from '@/lib/relationship-access'
import { isStage, STAGE_ORDINAL, correctionDedupeKey } from '@/lib/merchant-stage'

export const dynamic = 'force-dynamic'

interface CorrectionBody {
  toStage?: string
  reason?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (access.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Solo un administrador puede corregir la etapa.' }, { status: 403 })
  }

  let body: CorrectionBody = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }

  if (!isStage(body.toStage)) {
    return NextResponse.json({ ok: false, error: 'Etapa inválida.' }, { status: 400 })
  }

  if (body.reason !== undefined && typeof body.reason !== 'string') {
    return NextResponse.json({ ok: false, error: 'Razón inválida.' }, { status: 400 })
  }
  const reason = (body.reason ?? '').trim()
  if (!reason) {
    return NextResponse.json({ ok: false, error: 'La corrección requiere una razón.' }, { status: 422 })
  }

  const fromStage = access.relationship.stage
  const toStage = body.toStage
  const dedupeKey = correctionDedupeKey(randomUUID())

  const { error: transitionError } = await db.from('merchant_relationship_transitions').insert({
    relationship_id: id,
    from_stage: fromStage,
    to_stage: toStage,
    to_stage_ordinal: STAGE_ORDINAL[toStage],
    actor_type: 'admin',
    actor_id: auth.user.id,
    reason,
    dedupe_key: dedupeKey,
  })
  if (transitionError) {
    return NextResponse.json({ ok: false, error: 'No se pudo registrar la corrección.' }, { status: 500 })
  }

  // Mirror onto the relationship's own stage columns so the operating views
  // read the corrected truth — but only touch `stage_entered_at` when the
  // stage actually changed, so a reason-only correction of an already-correct
  // stage never resets "age in stage".
  let updatedRow: RelationshipRow = access.relationship
  if (toStage !== fromStage) {
    const { data, error: updateError } = await db
      .from('merchant_relationships')
      .update({ stage: toStage, stage_entered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('stage', fromStage) // D3d: compare-and-set — see file header.
      .select(
        'id, business_name, contact_name, phone_e164, email_normalized, whatsapp_e164, instagram_handle, ' +
          'estado, municipio, location_note, category, current_channels, preferred_channel, qualification, ' +
          'fit_note, objections, promoter_id, cohort, source, steward_clerk_user_id, shop_id, preview_id, ' +
          'stage, stage_entered_at, intake_complete, created_by, created_at, updated_at',
      )
      .maybeSingle()
    if (updateError || !data) {
      // The transition row is already committed (it's the audit truth); the
      // mirror failing to follow is reported, not silently hidden.
      return NextResponse.json(
        { ok: true, relationship: toRelationshipDTO(access.relationship), stageMirrorUpdated: false, dedupeKey },
        { status: 200 },
      )
    }
    updatedRow = data as unknown as RelationshipRow
  }

  return NextResponse.json({ ok: true, relationship: toRelationshipDTO(updatedRow), stageMirrorUpdated: true, dedupeKey })
}
