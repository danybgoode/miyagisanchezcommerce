/**
 * lib/portfolio/retention-server.ts
 *
 * Merchant Partner lifecycle · Sprint 3, Story 3.1 — the IMPURE half of the
 * 30-day retention check-in (README D7). Reads the relationship's earliest
 * `to_stage = 'first_sale'` transition and schedules ONE
 * `merchant_relationship_tasks` row (`kind = 'retention_30d'`), idempotent
 * by the migration's partial `UNIQUE (relationship_id, dedupe_key)`
 * constraint — never a SELECT-then-INSERT.
 *
 * CALLED FROM THE EXISTING `/api/cron/merchant-lifecycle-sweep`
 * (`lib/merchant-lifecycle-sweep.ts`, Sprint 3, Story 3.1), right after
 * `evaluateRelationship` for the SAME relationship — that is the sweep step
 * that DISCOVERS `first_sale`, so scheduling there costs no new cron and
 * cannot run before the transition exists. Safe to call unconditionally on
 * every non-terminal relationship on every run: `scheduleRetentionTask`
 * itself no-ops (`no_first_sale`) when the transition doesn't exist yet, and
 * no-ops (`already_scheduled`) when it does and the task was already
 * written — a replayed/late/duplicated sale fact cannot produce a second
 * task, because BOTH the transition it keys off (Sprint 2) and the task
 * this schedules (this sprint) are write-once.
 *
 * NEVER TOUCHES MEDUSA. Reads only `merchant_relationship_transitions` and
 * `merchant_relationships`, writes only `merchant_relationship_tasks` — no
 * sale, order, payment or product is read or written from this path
 * (`e2e/portfolio-retention.spec.ts` asserts no module under `lib/portfolio/`
 * imports `@/lib/medusa`, mechanically, over the whole directory).
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { RETENTION_WINDOW_DAYS } from '@/lib/merchant-medusa-reads'
import { retentionDedupeKey, retentionDueAt } from '@/lib/portfolio/retention'

const RETENTION_WINDOW_MS = RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** A non-Clerk, non-partner system actor — mirrors
 *  `lib/portfolio/reminders-server.ts`'s own `CRON_ACTOR` shape (kept as an
 *  independent literal here rather than importing that module's private
 *  constant, so this file adds no dependency on a Sprint-2 module it must
 *  not reshape). Never written as a real Clerk identity anywhere else. */
const RETENTION_SYSTEM_ACTOR = 'system:portfolio-retention-sweep'

export type ScheduleRetentionOutcome = 'scheduled' | 'already_scheduled' | 'no_first_sale' | 'error'

const UNIQUE_VIOLATION = '23505'

/**
 * Schedule the ONE retention task for `relationshipId`, if it has a
 * `first_sale` transition and doesn't already have one. Fail-closed on any
 * read error (`'error'`) — a failed read is retried on the next sweep run,
 * never silently treated as "nothing to schedule".
 */
export async function scheduleRetentionTask(
  relationshipId: string,
  now: Date = new Date(),
): Promise<ScheduleRetentionOutcome> {
  const { data: transition, error: transitionError } = await db
    .from('merchant_relationship_transitions')
    .select('occurred_at')
    .eq('relationship_id', relationshipId)
    .eq('to_stage', 'first_sale')
    .order('occurred_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (transitionError) {
    console.error('[portfolio/retention] first_sale transition read failed:', transitionError.message)
    return 'error'
  }
  if (!transition) return 'no_first_sale'

  const firstSaleMs = Date.parse(String(transition.occurred_at))
  if (!Number.isFinite(firstSaleMs)) {
    console.error('[portfolio/retention] unparseable first_sale occurred_at for', relationshipId)
    return 'error'
  }

  const { data: rel, error: relError } = await db
    .from('merchant_relationships')
    .select('steward_clerk_user_id')
    .eq('id', relationshipId)
    .maybeSingle()
  if (relError) {
    console.error('[portfolio/retention] relationship read failed:', relError.message)
    return 'error'
  }

  const dueAt = retentionDueAt(new Date(firstSaleMs), RETENTION_WINDOW_MS)
  const dedupeKey = retentionDedupeKey(relationshipId)

  const { error: insertError } = await db.from('merchant_relationship_tasks').insert({
    relationship_id: relationshipId,
    title: 'Check-in de retención a 30 días',
    due_at: dueAt,
    assigned_to: rel?.steward_clerk_user_id ?? null,
    kind: 'retention_30d',
    dedupe_key: dedupeKey,
    created_by: RETENTION_SYSTEM_ACTOR,
  })

  if (insertError) {
    // The constraint IS the idempotency guarantee (build contract) — a
    // unique violation means this relationship's retention task already
    // exists, never an error.
    if (insertError.code === UNIQUE_VIOLATION) return 'already_scheduled'
    console.error('[portfolio/retention] task insert failed:', insertError.message)
    return 'error'
  }
  return 'scheduled'
}
