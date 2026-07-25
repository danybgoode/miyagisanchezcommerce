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
 *
 * SHARED WRITER (merchant-partner-lifecycle S1.3, build contract: "Two routes,
 * two audiences, one shared writer"): the history-then-update sequence now
 * lives in `lib/portfolio/reassign-server.ts#reassignSteward`, which the new
 * ADMIN route (`POST /api/admin/relationship/[id]/reassign`) also calls — so the
 * D3a ordering and the attribution guarantee cannot differ between the two
 * audiences. THIS ROUTE'S BEHAVIOR IS UNCHANGED, deliberately: it passes only
 * `toSteward`, so the writer's positive-list payload builder emits only
 * `steward_clerk_user_id` + `updated_at` (never NULLing this sprint's new
 * `assignment_reason`/`assigned_at` columns), the history row carries no
 * reason/effective_at/tasks_transferred, a no-op reassignment still skips the
 * history insert, and no open task is touched. Nothing here was loosened, and it
 * was deliberately NOT made admin-only — that would break activation-ops S2.2's
 * shipped behavior. `STEWARD_ID_RE` moved to `lib/portfolio/reassign.ts` and is
 * imported, so the admin path can never validate this field more laxly than this
 * one does.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  authorizeRelationshipRequest,
  resolveRelationshipAccess,
  canWriteRelationship,
  toRelationshipDTO,
} from '@/lib/relationship-access'
import { STEWARD_ID_RE } from '@/lib/portfolio/reassign'
import { reassignSteward } from '@/lib/portfolio/reassign-server'

export const dynamic = 'force-dynamic'

interface OwnerBody {
  toSteward?: string | null
}

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

  // D3a (history FIRST, and a failed history write refuses the whole
  // reassignment) plus the no-op skip both live in the shared writer now.
  // `reason` / `effectiveAt` / `transferOpenTasks` are all omitted, which is what
  // keeps this route's writes byte-identical to its shipped behavior — see the
  // file header.
  const result = await reassignSteward({
    relationshipId: id,
    fromSteward,
    toSteward,
    actorClerkUserId: auth.user.id,
    now: new Date(),
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    ok: true,
    relationship: toRelationshipDTO(result.relationship),
    ownerHistoryRecorded: true,
  })
}
