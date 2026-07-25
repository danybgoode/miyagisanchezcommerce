/**
 * lib/portfolio/reassign-server.ts
 *
 * Merchant Partner lifecycle · Sprint 1, Story 1.3 — THE ONE WRITER for
 * stewardship reassignment. Two routes, two audiences, one writer:
 *
 *   · `POST /api/promoter/relationship/[id]/owner`  — the SHIPPED promoter-facing
 *     reassignment (activation-ops S2.2), gated by
 *     `promoter.activation_crm_enabled`. Deliberately NOT loosened and NOT made
 *     admin-only (that would break its shipped behavior). It passes only
 *     `toSteward`, so `buildStewardshipUpdate` emits only that column and the
 *     history row carries no reason — byte-identical to what it writes in
 *     production today.
 *   · `POST /api/admin/relationship/[id]/reassign` — the NEW privileged
 *     reassignment, gated by `promoter.partner_portfolio_enabled`, requiring a
 *     reason and an explicit open-task decision.
 *
 * ORDER OF OPERATIONS — deliberate, and the reasoning matters:
 *
 *   1. READ the open tasks (when the caller expressed a decision about them).
 *   2. TRANSFER them, if asked. Before the audit row, so the audit row can record
 *      the TRUE count rather than an intention; and before the access change, so a
 *      transfer failure aborts with nothing audited and no access moved. An
 *      `assigned_to` value is a label, never an access grant
 *      (`decideRelationshipRole` reads `steward_clerk_user_id`), so a task
 *      pointing at the incoming steward moments before they formally hold the
 *      record grants nobody anything.
 *   3. INSERT the owner-history row. PRESERVED FROM D3a (activation-ops PR 304,
 *      round 3): the audit row is written BEFORE the access-changing field, and a
 *      failed history write REFUSES the whole reassignment (500). Since
 *      stewardship itself grants access, the alternative ordering leaves a window
 *      where access has changed with no record of who changed it or why.
 *   4. UPDATE the relationship's stewardship columns.
 *
 * If 3 or 4 fails after 2 succeeded, the tasks were moved but the record was not.
 * That is reported, not hidden: an orphaned task reassignment is recoverable by
 * retrying the call, whereas an unaudited access change is not recoverable at all.
 * The same asymmetry the shipped owner route documents about its own orphaned
 * history row.
 *
 * ATTRIBUTION IS UNTOUCHABLE BY CONSTRUCTION. The payload comes from
 * `buildStewardshipUpdate` (`lib/portfolio/reassign.ts`), which can only ever
 * emit the four stewardship columns; this file never builds an update object of
 * its own. `promoter_id`, `cohort`, `source`, `preview_id` and `shop_id` are not
 * reachable from here, and no commission/transfer table is imported anywhere in
 * `lib/portfolio/` — both asserted mechanically in
 * `e2e/portfolio-reassign.spec.ts`.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import type { RelationshipRow } from '@/lib/relationship-access'
import { buildStewardshipUpdate } from '@/lib/portfolio/reassign'

/** The exact column list the shipped relationship routes select — kept identical
 *  so the DTO this writer returns is the same shape every other route returns. */
const RELATIONSHIP_COLUMNS =
  'id, business_name, contact_name, phone_e164, email_normalized, whatsapp_e164, instagram_handle, ' +
  'estado, municipio, location_note, category, current_channels, preferred_channel, qualification, ' +
  'fit_note, objections, promoter_id, cohort, source, steward_clerk_user_id, shop_id, preview_id, ' +
  'stage, stage_entered_at, intake_complete, created_by, created_at, updated_at'

export interface ReassignStewardInput {
  relationshipId: string
  /** The steward THIS request read, for the history row's `from_steward`. */
  fromSteward: string | null
  /** `null` clears the steward. */
  toSteward: string | null
  actorClerkUserId: string
  /**
   * ADMIN path only. `undefined` ⇒ the promoter path: `assignment_reason` /
   * `assigned_at` are NOT written and the history row's `reason` /
   * `effective_at` stay NULL, preserving that route's shipped behavior exactly.
   */
  reason?: string
  /** ADMIN path only, OPTIONAL even there. The partner-VISIBLE handoff note —
   *  `reason` is audit-only and is never rendered to a partner (finding 3,
   *  PR 308). `undefined` on the promoter path, so the column is not written. */
  handoffNote?: string | null
  effectiveAt?: string
  escalationClerkUserId?: string | null
  /**
   * `undefined` ⇒ the concept does not apply to this caller (the promoter path);
   * no task read happens and `tasks_transferred` stays NULL. `true`/`false` is
   * an explicit decision the admin path always supplies.
   */
  transferOpenTasks?: boolean
  now: Date
}

export type ReassignStewardResult =
  | {
      ok: true
      relationship: RelationshipRow
      /** How many open tasks existed at reassignment time. `null` when the
       *  caller expressed no decision about them. */
      openTaskCount: number | null
      /** How many actually moved to the new steward. `null` likewise. */
      tasksTransferred: number | null
    }
  | { ok: false; status: 500; error: string; tasksTransferred?: number }

export async function reassignSteward(input: ReassignStewardInput): Promise<ReassignStewardResult> {
  const { relationshipId, fromSteward, toSteward, actorClerkUserId, transferOpenTasks } = input
  const nowIso = input.now.toISOString()
  const isPrivileged = input.reason !== undefined

  // ── 1. Read the open tasks (only when a decision was expressed) ──
  let openTaskIds: string[] | null = null
  if (transferOpenTasks !== undefined) {
    const { data, error } = await db
      .from('merchant_relationship_tasks')
      .select('id')
      .eq('relationship_id', relationshipId)
      .is('completed_at', null)
    if (error) {
      // Fail closed BEFORE anything is written: we cannot honestly record how
      // many tasks moved if we cannot see how many there are.
      console.error('[portfolio/reassign] open-task read failed — refusing the reassignment:', error.message)
      return { ok: false, status: 500, error: 'No se pudieron leer las tareas abiertas; la reasignación no se aplicó.' }
    }
    openTaskIds = ((data ?? []) as Array<{ id: string }>).map((t) => t.id)
  }

  // ── 2. Transfer them, if asked ──
  let tasksTransferred: number | null = transferOpenTasks === undefined ? null : 0
  if (transferOpenTasks === true && openTaskIds !== null && openTaskIds.length > 0) {
    const { error } = await db
      .from('merchant_relationship_tasks')
      .update({ assigned_to: toSteward })
      .in('id', openTaskIds)
    if (error) {
      console.error('[portfolio/reassign] open-task transfer failed — refusing the reassignment:', error.message)
      return {
        ok: false,
        status: 500,
        error: 'No se pudieron transferir las tareas abiertas; la reasignación no se aplicó.',
      }
    }
    tasksTransferred = openTaskIds.length
  }

  // ── 3. Owner history FIRST (D3a) ──
  // A no-op steward change on the PROMOTER path has nothing to audit (its
  // shipped behavior). The PRIVILEGED path always audits: re-affirming the same
  // steward with a new reason is itself a decision worth a permanent record.
  const stewardChanged = fromSteward !== toSteward
  if (stewardChanged || isPrivileged) {
    const historyRow: Record<string, unknown> = {
      relationship_id: relationshipId,
      from_steward: fromSteward,
      to_steward: toSteward,
      actor_clerk_user_id: actorClerkUserId,
    }
    if (input.reason !== undefined) historyRow.reason = input.reason
    if (input.effectiveAt !== undefined) historyRow.effective_at = input.effectiveAt
    if (tasksTransferred !== null) historyRow.tasks_transferred = tasksTransferred

    const { error } = await db.from('merchant_relationship_owner_history').insert(historyRow)
    if (error) {
      console.error('[portfolio/reassign] owner history insert failed — refusing the reassignment:', error.message)
      return {
        ok: false,
        status: 500,
        error: 'No se pudo registrar el historial de auditoría; la reasignación no se aplicó.',
        ...(tasksTransferred !== null && tasksTransferred > 0 ? { tasksTransferred } : {}),
      }
    }
  }

  // ── 4. The access-changing update, from the positive-list builder ──
  const update = buildStewardshipUpdate({
    toSteward,
    // The promoter path passes neither, so neither column is written.
    assignmentReason: isPrivileged ? (input.reason ?? null) : undefined,
    assignmentHandoffNote: isPrivileged ? (input.handoffNote ?? null) : undefined,
    assignedAt: isPrivileged ? (input.effectiveAt ?? nowIso) : undefined,
    escalationClerkUserId: input.escalationClerkUserId,
    now: nowIso,
  })

  const { data, error } = await db
    .from('merchant_relationships')
    .update(update)
    .eq('id', relationshipId)
    .select(RELATIONSHIP_COLUMNS)
    .maybeSingle()

  if (error || !data) {
    // The history row (if one was written) now describes a reassignment that
    // never took effect. An orphaned audit entry is a strictly smaller problem
    // than an unaudited access change, and a compensating delete could itself
    // fail and compound the inconsistency — the exact tradeoff the shipped
    // owner route already documents.
    return {
      ok: false,
      status: 500,
      error: 'No se pudo reasignar el dueño.',
      ...(tasksTransferred !== null && tasksTransferred > 0 ? { tasksTransferred } : {}),
    }
  }

  return {
    ok: true,
    relationship: data as unknown as RelationshipRow,
    openTaskCount: openTaskIds === null ? null : openTaskIds.length,
    tasksTransferred,
  }
}
