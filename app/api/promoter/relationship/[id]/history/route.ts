/**
 * GET /api/promoter/relationship/[id]/history — the full audit trail for one
 * relationship: stage transitions (incl. corrections), interactions, tasks
 * and owner-reassignment history (founding-merchant-activation-ops S2.3).
 *
 * BUILD-CONTRACT ADDITION, flagged: sprint-2.md's route list doesn't include
 * a GET for row-level detail, but S2.3's acceptance explicitly requires it
 * ("each row opens history + evidence" — both `/promotor/relaciones` and
 * `/admin/relaciones`). Added here under the SAME `/api/promoter/relationship/[id]/*`
 * prefix S1's `consent` route already uses, rather than inventing a
 * mismatched `/api/admin/relationship/[id]/history` duplicate — scope is
 * checked through the ONE shared helper (`resolveRelationshipAccess`), which
 * already grants admin unconditionally, so ONE route correctly serves BOTH
 * operating views without re-deriving the access rule a second time.
 *
 * READ-only: `resolveRelationshipAccess` alone is sufficient (a `viewer`
 * grant may read history; `canWriteRelationship` is not checked here because
 * nothing is written). Gated by `promoter.activation_crm_enabled` FIRST (404
 * when OFF, via `authorizeRelationshipRequest`).
 *
 * C7 fix (PR 304 review): the response now includes `role` (the caller's
 * OWN `resolveRelationshipAccess` role for this exact relationship) so
 * `RelationshipHistoryPanel` can hide write controls a `viewer` grant would
 * only have the API reject — the panel has no other way to learn its role,
 * since access is resolved per-relationship, not per-page.
 *
 * C3 fix (PR 304 review): any one of the four reads failing now 500s the
 * WHOLE response instead of silently substituting `[]` for that section —
 * an empty transitions/interactions/tasks/owner-history array must mean
 * "genuinely nothing happened", never "the read broke".
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { authorizeRelationshipRequest, resolveRelationshipAccess, toRelationshipDTO } from '@/lib/relationship-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })

  const [transitionsRes, interactionsRes, tasksRes, ownerHistoryRes] = await Promise.all([
    db
      .from('merchant_relationship_transitions')
      .select('id, from_stage, to_stage, to_stage_ordinal, actor_type, actor_id, reason, evidence_ref, dedupe_key, occurred_at, created_at')
      .eq('relationship_id', id)
      .order('occurred_at', { ascending: true }),
    db
      .from('merchant_relationship_interactions')
      .select('id, kind, body, author_clerk_user_id, occurred_at, created_at')
      .eq('relationship_id', id)
      .order('occurred_at', { ascending: false }),
    db
      .from('merchant_relationship_tasks')
      .select('id, title, due_at, assigned_to, completed_at, completed_by, created_by, created_at')
      .eq('relationship_id', id)
      .order('created_at', { ascending: false }),
    db
      .from('merchant_relationship_owner_history')
      .select('id, from_steward, to_steward, actor_clerk_user_id, at')
      .eq('relationship_id', id)
      .order('at', { ascending: false }),
  ])

  if (transitionsRes.error || interactionsRes.error || tasksRes.error || ownerHistoryRes.error) {
    return NextResponse.json({ ok: false, error: 'No se pudo cargar el historial.' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    relationship: toRelationshipDTO(access.relationship),
    role: access.role,
    transitions: transitionsRes.data ?? [],
    interactions: interactionsRes.data ?? [],
    tasks: tasksRes.data ?? [],
    ownerHistory: ownerHistoryRes.data ?? [],
  })
}
