/**
 * POST /api/promoter/relationship/[id]/owner — reassign the relationship's
 * steward (founding-merchant-activation-ops S2.2). Writes
 * `merchant_relationship_owner_history` AND
 * `merchant_relationships.steward_clerk_user_id` in the SAME request (build
 * contract) — the history row is written FIRST (D3a, see below).
 *
 * `toSteward: null` (or an empty string) explicitly CLEARS the steward — a
 * deliberate "nobody owns this right now" state, distinct from never having
 * set one.
 *
 * Scope-checked through the ONE shared helper (`resolveRelationshipAccess`);
 * a `viewer` partner-grant may READ but not WRITE (`canWriteRelationship`).
 * Gated by `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`).
 *
 * C9 fix (PR 304 review): `toSteward` is now runtime type-checked BEFORE
 * `.trim()` touches it — `{toSteward: 123}` used to 500.
 *
 * C1 follow-up (PR 304 review, "answer, don't fix" list): since
 * `resolveRelationshipAccess` now grants `manager` access to whoever's Clerk
 * id matches `steward_clerk_user_id` (C1, floored by D1), this field is
 * load-bearing for ACCESS, not just a display label — a basic format/length
 * sanity check is added below (no Clerk existence lookup, per the review's
 * explicit scope).
 *
 * D3a fix (PR 304 review, round 3): the AUDIT trail is now written BEFORE
 * the access-changing primary field, and a failed history write REFUSES the
 * whole reassignment (500) rather than reporting `ownerHistoryRecorded:
 * false` after access already changed. The original order (primary write,
 * then audit — `ownerHistoryRecorded: false` on failure) left a window where
 * access had ALREADY changed with NO record of it; now that stewardship
 * itself grants access (C1), that window is a genuine "access changed,
 * nobody can prove why or by whom" gap, not just a cosmetic audit-trail
 * miss. Fail closed: no history row, no access change.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import {
  authorizeRelationshipRequest,
  resolveRelationshipAccess,
  canWriteRelationship,
  toRelationshipDTO,
  type RelationshipRow,
} from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

interface OwnerBody {
  toSteward?: string | null
}

// A Clerk user id's own shape (`user_<base62ish>`) is narrower than this, but
// this repo doesn't parse Clerk ids anywhere else either — a generous
// safe-charset + length cap is enough to stop garbage from becoming a
// load-bearing access value without hardcoding Clerk's own format.
const STEWARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Tu acceso a este registro es de solo lectura (viewer) — reasignar dueño requiere el rol manager.',
      },
      { status: 403 },
    )
  }

  let body: OwnerBody = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo inválido.' }, { status: 400 })
  }

  if (body.toSteward !== undefined && body.toSteward !== null && typeof body.toSteward !== 'string') {
    return NextResponse.json({ ok: false, error: 'Dueño inválido.' }, { status: 400 })
  }

  const fromSteward = access.relationship.steward_clerk_user_id
  const toSteward = (body.toSteward ?? '').trim() || null

  if (toSteward !== null && !STEWARD_ID_RE.test(toSteward)) {
    return NextResponse.json({ ok: false, error: 'Dueño inválido.' }, { status: 400 })
  }

  // D3a: history FIRST. A no-op reassignment (fromSteward === toSteward)
  // has nothing to audit, so it skips straight to the (harmless) primary
  // write below.
  if (fromSteward !== toSteward) {
    const { error: historyError } = await db.from('merchant_relationship_owner_history').insert({
      relationship_id: id,
      from_steward: fromSteward,
      to_steward: toSteward,
      actor_clerk_user_id: auth.user.id,
    })
    if (historyError) {
      console.error('[relationship/owner] owner history insert failed — refusing the reassignment:', historyError.message)
      return NextResponse.json(
        { ok: false, error: 'No se pudo registrar el historial de auditoría; la reasignación no se aplicó.' },
        { status: 500 },
      )
    }
  }

  const { data, error } = await db
    .from('merchant_relationships')
    .update({ steward_clerk_user_id: toSteward, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(
      'id, business_name, contact_name, phone_e164, email_normalized, whatsapp_e164, instagram_handle, ' +
        'estado, municipio, location_note, category, current_channels, preferred_channel, qualification, ' +
        'fit_note, objections, promoter_id, cohort, source, steward_clerk_user_id, shop_id, preview_id, ' +
        'stage, stage_entered_at, intake_complete, created_by, created_at, updated_at',
    )
    .maybeSingle()

  if (error || !data) {
    // The history row (if one was written above) now describes a
    // reassignment that never actually took effect — an orphaned audit
    // entry is a strictly smaller problem than an unaudited access change,
    // and a rare failure at this specific step (after a successful insert
    // one line above) is not worth a compensating delete that could itself
    // fail and compound the inconsistency.
    return NextResponse.json({ ok: false, error: 'No se pudo reasignar el dueño.' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    relationship: toRelationshipDTO(data as unknown as RelationshipRow),
    ownerHistoryRecorded: true,
  })
}
