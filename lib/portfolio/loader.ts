/**
 * lib/portfolio/loader.ts
 *
 * Merchant Partner lifecycle · Sprint 1, Story 1.2 — the IMPURE half of the
 * partner work queue. Gathers every input `resolvePortfolio`
 * (`lib/portfolio/resolver.ts`) needs through the reuse seams the build contract
 * names, then calls the pure resolver. Same shape as
 * `lib/scorecard/loader.ts`, copied deliberately.
 *
 * README D1 — THE PORTFOLIO IS A READ MODEL, NEVER A SECOND CRM. The scoped
 * population is `listScopedRelationships` (`lib/relationship-list.ts`) — the
 * SAME four populations (`promoter_id` owner, steward, active `partner_grants`
 * shop, admin) that decide every per-id 403 in
 * `resolveRelationshipAccess`. No authorization rule is invented here; this
 * module never queries `merchant_relationships` for a population of its own.
 * The view fields come from `enrichRelationships`
 * (`lib/relationship-enrich.ts`), which already composes the shipped
 * `lib/relationship-pipeline.ts` predicates. Only the SLA layer is new.
 *
 * FAIL CLOSED ON EVERY READ. Each of the five reads below returns
 * `{ ok: false }` on a Supabase error rather than substituting `[]`/`false`.
 * A read failure and "genuinely nothing there" must never look the same: a
 * silently-empty open-task map would make every row report "no next action" —
 * a false operational claim manufactured from a DB hiccup — and a
 * silently-empty relationship list would tell a partner their portfolio is
 * empty. That exact bug has shipped in this family twice (C3, PR 304; the
 * `loadReconciliationRows` gap `lib/scorecard/resolver.ts` still documents),
 * and the route turns `{ ok: false }` into a 500, never a 200.
 *
 * NO N+1: the last-interaction read is ONE batched query over
 * `merchant_relationship_interactions` (build contract), and so is the
 * open-task read.
 *
 * WHY A SEPARATE READ FOR THE STEWARDSHIP COLUMNS: `listScopedRelationships`
 * selects a fixed `COLUMNS` list and hands back `RelationshipRow`, both shared
 * with three shipped epics (the promoter intake, the admin operating views, the
 * scorecard) through `toRelationshipDTO`. Widening that list and that interface
 * to carry this sprint's five new columns would edit the seam every one of them
 * reads. One extra BATCHED query (`.in('id', ids)`) buys zero blast radius on
 * shipped surfaces. It also means this loader only works once the Sprint-1
 * migration is applied — which is fine and intended: the flag that reaches this
 * code is flipped only after the migration is verified live.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import type { RelationshipActor } from '@/lib/relationship-access'
import { listScopedRelationships } from '@/lib/relationship-list'
import { enrichRelationships } from '@/lib/relationship-enrich'
import type { OpenTaskFact } from '@/lib/relationship-pipeline'
import { resolveSlaState, type SlaPolicy } from '@/lib/portfolio/sla'
import { loadSlaPolicy } from '@/lib/portfolio/policy-server'
import {
  resolvePortfolio,
  type Portfolio,
  type PortfolioFilters,
  type PortfolioInputRow,
} from '@/lib/portfolio/resolver'

export type LoadPortfolioResult = { ok: true; portfolio: Portfolio } | { ok: false; error: string }

interface StewardshipColumns {
  assignmentReason: string | null
  assignedAt: string | null
  escalationClerkUserId: string | null
}

type StewardshipResult = { ok: true; byId: Map<string, StewardshipColumns> } | { ok: false }

/** ONE batched read of this sprint's additive columns (see the file header for
 *  why they aren't folded into `listScopedRelationships`'s COLUMNS). */
async function readStewardshipColumns(ids: string[]): Promise<StewardshipResult> {
  const byId = new Map<string, StewardshipColumns>()
  if (ids.length === 0) return { ok: true, byId }
  const { data, error } = await db
    .from('merchant_relationships')
    .select('id, assignment_reason, assigned_at, escalation_clerk_user_id')
    .in('id', ids)
  if (error) {
    console.error('[portfolio/loader] stewardship column read failed:', error.message)
    return { ok: false }
  }
  for (const row of (data ?? []) as Array<{
    id: string
    assignment_reason: string | null
    assigned_at: string | null
    escalation_clerk_user_id: string | null
  }>) {
    byId.set(row.id, {
      assignmentReason: row.assignment_reason,
      assignedAt: row.assigned_at,
      escalationClerkUserId: row.escalation_clerk_user_id,
    })
  }
  return { ok: true, byId }
}

type OpenTasksResult = { ok: true; byId: Map<string, OpenTaskFact[]> } | { ok: false }

/**
 * ONE batched read of every OPEN task, fed to `resolveSlaState` so the SLA layer
 * runs the SHIPPED `nextOpenTask`/`isMissingAction` predicates over the real
 * task list rather than over a precomputed summary. `enrichRelationships` reads
 * the same table with the same predicate for its own `nextAction`/`overdue`
 * fields; the two cannot DISAGREE (they call the same pure functions on the same
 * rows), and paying for one extra batched query is cheaper than widening the
 * shipped `EnrichedRelationship` contract to carry raw tasks.
 */
async function readOpenTasks(ids: string[]): Promise<OpenTasksResult> {
  const byId = new Map<string, OpenTaskFact[]>()
  if (ids.length === 0) return { ok: true, byId }
  const { data, error } = await db
    .from('merchant_relationship_tasks')
    .select('id, relationship_id, due_at')
    .is('completed_at', null)
    .in('relationship_id', ids)
  if (error) {
    console.error('[portfolio/loader] open-task read failed:', error.message)
    return { ok: false }
  }
  for (const t of (data ?? []) as Array<{ id: string; relationship_id: string; due_at: string | null }>) {
    const arr = byId.get(t.relationship_id) ?? []
    arr.push({ id: t.id, dueAt: t.due_at })
    byId.set(t.relationship_id, arr)
  }
  return { ok: true, byId }
}

type LastInteractionResult = { ok: true; byId: Map<string, string> } | { ok: false }

/**
 * ONE batched read (build contract: "not N+1"). Ordered newest-first and the
 * FIRST row per relationship wins, so this is "the last interaction" by
 * calendar time and not by whatever order Postgres felt like returning —
 * the same explicit-`.order()` discipline the D4 fix in
 * `lib/relationship-list.ts` had to add after a merged result depended on Map
 * insertion order.
 */
async function readLastInteractions(ids: string[]): Promise<LastInteractionResult> {
  const byId = new Map<string, string>()
  if (ids.length === 0) return { ok: true, byId }
  const { data, error } = await db
    .from('merchant_relationship_interactions')
    .select('relationship_id, occurred_at')
    .in('relationship_id', ids)
    .order('occurred_at', { ascending: false })
  if (error) {
    console.error('[portfolio/loader] last-interaction read failed:', error.message)
    return { ok: false }
  }
  for (const row of (data ?? []) as Array<{ relationship_id: string; occurred_at: string }>) {
    if (!byId.has(row.relationship_id)) byId.set(row.relationship_id, row.occurred_at)
  }
  return { ok: true, byId }
}

/**
 * Load + resolve the calling actor's portfolio. `now` defaults to the real
 * clock; a spec or route may pass a fixed instant.
 *
 * `policy` may be supplied by the caller (the `/partner` page loads it once for
 * the whole render); otherwise it is read here. Either way the CODE default is
 * the fallback — `loadSlaPolicy` never returns null and never returns a partial
 * policy.
 */
export async function loadPortfolio(
  actor: RelationshipActor,
  filters: PortfolioFilters,
  now: Date = new Date(),
  policy?: SlaPolicy,
): Promise<LoadPortfolioResult> {
  const listResult = await listScopedRelationships(actor)
  if (!listResult.ok) return { ok: false, error: 'No se pudo leer tu cartera de comercios.' }

  const enrichResult = await enrichRelationships(listResult.rows, now)
  if (!enrichResult.ok) return { ok: false, error: 'No se pudo calcular el resumen de tu cartera.' }

  const ids = enrichResult.relationships.map((r) => r.id)

  const [stewardship, openTasks, lastInteractions] = await Promise.all([
    readStewardshipColumns(ids),
    readOpenTasks(ids),
    readLastInteractions(ids),
  ])
  if (!stewardship.ok || !openTasks.ok || !lastInteractions.ok) {
    // Fail the WHOLE call closed. Merging a partial result would silently
    // under-report SLA state for part of the portfolio, which is worse than an
    // honest error: the rows that DID load would look tended.
    return { ok: false, error: 'No se pudo leer el estado de seguimiento de tu cartera.' }
  }

  const activePolicy = policy ?? (await loadSlaPolicy()).policy

  const inputs: PortfolioInputRow[] = enrichResult.relationships.map((r) => {
    const steward = stewardship.byId.get(r.id)
    const tasks = openTasks.byId.get(r.id) ?? []
    const lastInteractionAt = lastInteractions.byId.get(r.id) ?? null
    return {
      id: r.id,
      businessName: r.businessName,
      contactName: r.contactName,
      estado: r.estado,
      municipio: r.municipio,
      category: r.category,
      stage: r.stage,
      stageEnteredAt: r.stageEnteredAt,
      createdAt: r.createdAt,
      preferredChannel: r.preferredChannel,
      stewardClerkUserId: r.stewardClerkUserId,
      assignmentReason: steward?.assignmentReason ?? null,
      assignedAt: steward?.assignedAt ?? null,
      ageInStageDays: r.ageInStageDays,
      nextAction: r.nextAction,
      missingAction: r.missingAction,
      blocker: r.blocker,
      consentState: r.consentState,
      openTaskCount: tasks.length,
      lastInteractionAt,
      sla: resolveSlaState(
        {
          stage: r.stage,
          stageEnteredAt: r.stageEnteredAt,
          openTasks: tasks,
          lastInteractionAt,
          escalationClerkUserId: steward?.escalationClerkUserId ?? null,
        },
        activePolicy,
        now,
      ),
    }
  })

  return { ok: true, portfolio: resolvePortfolio(inputs, filters, activePolicy.version, now) }
}
