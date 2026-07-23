/**
 * POST /api/promoter/relationship/[id]/owner — reassign the relationship's
 * steward (founding-merchant-activation-ops S2.2). Writes
 * `merchant_relationships.steward_clerk_user_id` AND a
 * `merchant_relationship_owner_history` row in the SAME request (build
 * contract). The primary field write is what actually changes who owns
 * follow-up; the history row is the audit trail — its failure is reported
 * (`ownerHistoryRecorded: false`) but never rolls back the primary write,
 * same posture as S1's `auditFieldChanges` (a write already committed can't
 * be un-committed, and the failure must never be swallowed silently).
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
 * id matches `steward_clerk_user_id` (C1), this field is load-bearing for
 * ACCESS, not just a display label — a basic format/length sanity check is
 * added below (no Clerk existence lookup, per the review's explicit scope).
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
    return NextResponse.json({ ok: false, error: 'No se pudo reasignar el dueño.' }, { status: 500 })
  }

  let ownerHistoryRecorded = true
  if (fromSteward !== toSteward) {
    const { error: historyError } = await db.from('merchant_relationship_owner_history').insert({
      relationship_id: id,
      from_steward: fromSteward,
      to_steward: toSteward,
      actor_clerk_user_id: auth.user.id,
    })
    if (historyError) {
      console.error('[relationship/owner] owner history insert failed:', historyError.message)
      ownerHistoryRecorded = false
    }
  }

  return NextResponse.json({
    ok: true,
    relationship: toRelationshipDTO(data as unknown as RelationshipRow),
    ownerHistoryRecorded,
  })
}
