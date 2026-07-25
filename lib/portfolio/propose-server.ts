/**
 * lib/portfolio/propose-server.ts
 *
 * Merchant Partner lifecycle · Sprint 3, Story 3.2 — the IMPURE half of the
 * partner-agent propose/confirm boundary. `createTaskUpdateProposal` writes
 * an INERT `merchant_portfolio_proposals` row (build contract) — nothing on
 * `merchant_relationship_tasks` or `merchant_relationship_interactions`
 * changes until `confirmTaskUpdateProposal` is called separately, and THAT
 * function re-runs `resolveRelationshipAccess` + `canWriteRelationship`
 * against the CONFIRMING credential — never the proposal's own scope, and
 * never a credential that only proposed it.
 *
 * THE CONFIRM WRITE IS A POSITIVE-LIST FIELD SET (build contract): only the
 * six `lib/portfolio/propose.ts#TaskUpdateProposal` keys are ever read off
 * the stored payload, by name — no `.update(payload)` spread anywhere in
 * this file. `steward_clerk_user_id`, `promoter_id`, `cohort`, `shop_id` are
 * unreachable from here, and no commission/transfer table or Medusa client
 * is imported anywhere in `lib/portfolio/` — asserted in
 * `e2e/portfolio-partner-mcp.spec.ts`.
 *
 * NEVER SENDS ANYTHING. The optional interaction append writes ONE
 * append-only `merchant_relationship_interactions` row (`kind: 'note'`) —
 * the exact same table a human's UI note-entry writes to — never a
 * transport. No module in this file imports `lib/notify.ts`, `lib/email.ts`,
 * `lib/telegram.ts` or `lib/notifications/dispatch.ts`.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { resolveRelationshipAccess, canWriteRelationship, type RelationshipActor } from '@/lib/relationship-access'
import { isAllowedOutcome } from '@/lib/portfolio/retention'
import {
  parseTaskUpdateProposal,
  describeTaskUpdateProposal,
  type TaskUpdateProposal,
} from '@/lib/portfolio/propose'

/** Proposals not confirmed within this window are treated as expired — a
 *  stale, unconfirmed intent from an earlier agent turn should not be
 *  silently applicable much later by a different call. */
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000

export type CreateProposalResult =
  | { ok: true; proposalId: string; diff: string }
  | { ok: false; status: 400 | 403 | 500; error: string }

export async function createTaskUpdateProposal(
  relationshipId: string,
  actor: RelationshipActor,
  proposedBy: string,
  rawPayload: unknown,
  now: Date = new Date(),
): Promise<CreateProposalResult> {
  const access = await resolveRelationshipAccess(relationshipId, actor)
  if (!access.ok) return { ok: false, status: 403, error: 'No autorizado.' }
  if (!canWriteRelationship(access.role)) {
    return { ok: false, status: 403, error: 'Tu acceso a este registro es de solo lectura.' }
  }

  const parsed = parseTaskUpdateProposal(rawPayload)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }

  if (parsed.payload.outcome !== undefined && !isAllowedOutcome(parsed.payload.outcome)) {
    return { ok: false, status: 400, error: 'outcome no permitido.' }
  }

  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString()
  const { data, error } = await db
    .from('merchant_portfolio_proposals')
    .insert({
      relationship_id: relationshipId,
      proposed_by: proposedBy,
      payload: parsed.payload,
      expires_at: expiresAt,
    })
    .select('id')
    .maybeSingle()

  if (error || !data) {
    console.error('[portfolio/propose] insert failed:', error?.message)
    return { ok: false, status: 500, error: 'No se pudo crear la propuesta.' }
  }

  return { ok: true, proposalId: String(data.id), diff: describeTaskUpdateProposal(parsed.payload) }
}

export type ConfirmProposalResult =
  | { ok: true; task: Record<string, unknown>; interactionAdded: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 500; error: string }

const TASK_SELECT_COLS =
  'id, relationship_id, title, due_at, assigned_to, outcome, completed_at, completed_by, created_by, created_at'

/**
 * Confirm and apply a previously-created proposal. Re-runs
 * `resolveRelationshipAccess` + `canWriteRelationship` against `actor` —
 * the CONFIRMING credential — regardless of who proposed it or what scope
 * they had.
 */
export async function confirmTaskUpdateProposal(
  relationshipId: string,
  proposalId: string,
  actor: RelationshipActor,
  confirmedBy: string,
  now: Date = new Date(),
): Promise<ConfirmProposalResult> {
  const access = await resolveRelationshipAccess(relationshipId, actor)
  if (!access.ok) return { ok: false, status: 403, error: 'No autorizado.' }
  if (!canWriteRelationship(access.role)) {
    return { ok: false, status: 403, error: 'Tu acceso a este registro es de solo lectura.' }
  }

  const { data: proposal, error: readError } = await db
    .from('merchant_portfolio_proposals')
    .select('id, relationship_id, proposed_by, payload, expires_at, confirmed_at')
    .eq('id', proposalId)
    .eq('relationship_id', relationshipId)
    .maybeSingle()
  if (readError || !proposal) return { ok: false, status: 404, error: 'Propuesta no encontrada.' }
  const expiresMs = Date.parse(String(proposal.expires_at))
  if (!Number.isFinite(expiresMs) || expiresMs < now.getTime()) {
    return { ok: false, status: 409, error: 'La propuesta expiró.' }
  }

  // VALIDATE BEFORE CLAIMING (cross-agent review round 2, PR 311). Moving the
  // claim ahead of the apply fixed the double-apply — and introduced a NEW failure
  // mode: an unapplicable payload got its proposal permanently consumed (claim
  // succeeds, apply fails, every retry 409s). `parseTaskUpdateProposal` now
  // normalizes and calendar-validates the dates at PROPOSE time, so a bad payload
  // can no longer become a stored proposal at all; this is the second line of
  // defence, for a row written BEFORE that fix or inserted by hand.
  //
  // Validation is PURE and has no side effects, so it belongs before the claim.
  // The resulting order — validate → claim → apply — is strictly better than
  // either of the two previous orderings: it cannot double-apply, and it cannot
  // burn a proposal it was never going to be able to apply.
  const revalidated = parseTaskUpdateProposal(proposal.payload)
  if (!revalidated.ok) {
    return {
      ok: false,
      status: 422,
      error: `La propuesta guardada ya no es aplicable (${revalidated.error}). Genera una nueva.`,
    }
  }

  // ── CLAIM THE PROPOSAL BEFORE APPLYING IT (cross-agent review, PR 311) ──
  //
  // The read above tells us the proposal LOOKED unconfirmed; it cannot tell us we
  // are the only one acting on it. The original order — read `confirmed_at`, apply
  // the payload, THEN stamp — let two concurrent confirms of the same
  // create-task proposal both pass the check and both insert, producing duplicate
  // tasks and duplicate interaction notes. A read is not a claim.
  //
  // So the stamp moves FIRST and becomes a conditional claim: `.is('confirmed_at',
  // null)` + a select-back makes the affected-row count observable (supabase-js
  // reports no error for an UPDATE that matched nothing, so without the select the
  // loser of the race looks exactly like the winner). Exactly one caller can ever
  // win; every other gets 409.
  //
  // The ordering trade-off is deliberate and matches this epic's reminder rail
  // (`lib/portfolio/reminders-server.ts`): claim-then-apply can at worst
  // UNDER-apply once — a crash between claim and apply consumes the proposal
  // without effect, and the partner sees an error and proposes again. Apply-then-
  // claim DOUBLE-applies, and a duplicate task in a partner's queue is a false
  // operational fact that outlives the request. Under-applying is visible;
  // double-applying is not.
  const { data: claimed, error: claimError } = await db
    .from('merchant_portfolio_proposals')
    .update({ confirmed_at: now.toISOString(), confirmed_by: confirmedBy })
    .eq('id', proposalId)
    .is('confirmed_at', null)
    .select('id')
  if (claimError) {
    console.error('[portfolio/propose] confirm claim failed:', claimError.message)
    return { ok: false, status: 500, error: 'No se pudo confirmar la propuesta.' }
  }
  if (!claimed || claimed.length === 0) {
    return { ok: false, status: 409, error: 'La propuesta ya fue confirmada.' }
  }

  // The REVALIDATED (and date-normalized) payload — never the raw stored JSON.
  const payload = revalidated.payload

  // ── The confirm write — POSITIVE-LIST, named field by field ────────────
  let taskRow: Record<string, unknown> | null = null
  if (payload.taskId) {
    const update: Record<string, unknown> = {}
    if (payload.title !== undefined) update.title = payload.title
    if (payload.dueAt !== undefined) update.due_at = payload.dueAt
    if (payload.outcome !== undefined) update.outcome = payload.outcome
    if (payload.completedAt !== undefined) {
      update.completed_at = payload.completedAt
      update.completed_by = confirmedBy
    }
    const { data, error } = await db
      .from('merchant_relationship_tasks')
      .update(update)
      .eq('id', payload.taskId)
      .eq('relationship_id', relationshipId)
      .select(TASK_SELECT_COLS)
      .maybeSingle()
    if (error || !data) {
      console.error('[portfolio/propose] task update failed:', error?.message)
      return { ok: false, status: 500, error: 'No se pudo aplicar la propuesta.' }
    }
    taskRow = data
  } else {
    const { data, error } = await db
      .from('merchant_relationship_tasks')
      .insert({
        relationship_id: relationshipId,
        title: payload.title,
        due_at: payload.dueAt ?? null,
        assigned_to: confirmedBy,
        created_by: String(proposal.proposed_by ?? confirmedBy),
      })
      .select(TASK_SELECT_COLS)
      .maybeSingle()
    if (error || !data) {
      console.error('[portfolio/propose] task insert failed:', error?.message)
      return { ok: false, status: 500, error: 'No se pudo aplicar la propuesta.' }
    }
    taskRow = data
  }

  let interactionAdded = false
  if (payload.interactionNote) {
    const { error } = await db.from('merchant_relationship_interactions').insert({
      relationship_id: relationshipId,
      kind: 'note',
      body: payload.interactionNote,
      author_clerk_user_id: confirmedBy,
    })
    if (error) console.error('[portfolio/propose] interaction insert failed:', error.message)
    else interactionAdded = true
  }

  // The confirmation stamp already happened, as the CLAIM above — see its comment.

  return { ok: true, task: taskRow, interactionAdded }
}
