/**
 * lib/scorecard/loader.ts
 *
 * Merchant activation scorecard · Sprint 1, Story 1.2 — the IMPURE half of
 * the canonical join. Gathers every input `resolveScorecard`
 * (`lib/scorecard/resolver.ts`) needs via the reuse seams named in the
 * README's "what already exists" table, then calls the pure resolver. This
 * is the ONLY module in the epic that imports `RETENTION_WINDOW_DAYS` /
 * `THREE_PRODUCTS_THRESHOLD` from `lib/merchant-medusa-reads.ts` — see
 * `lib/scorecard/dictionary.ts`'s file header for why (that module is
 * `server-only`-tainted; a zero-import pure module can never import it
 * directly).
 *
 * SD1: `listAllRelationships` + `enrichRelationships` (canonical Miyagi
 * tables) are the funnel/aging source; `merchant_relationship_transitions`
 * (read directly here — no existing lib function reads it in bulk) is the
 * time-in-stage source; `loadReconciliationRows()` is read ONCE and reused
 * for BOTH the freshness diagnostic AND the first-sale/retention commerce
 * facts (it already calls `loadCommerceFacts` per relationship internally —
 * calling it a second time here would be a redundant Medusa read, not a
 * second source of truth).
 *
 * READ-ONLY: every call below is a `.select()` or a GET (transitively, via
 * the reused modules). No write.
 *
 * Runtime: Node only (Supabase service-role client, via the reused seams).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { listAllRelationships } from '@/lib/relationship-list'
import { enrichRelationships } from '@/lib/relationship-enrich'
import { loadReconciliationRows } from '@/lib/relationship-reconciliation'
import { RETENTION_WINDOW_DAYS, THREE_PRODUCTS_THRESHOLD } from '@/lib/merchant-medusa-reads'
import { resolveScorecard } from '@/lib/scorecard/resolver'
import type {
  Scorecard,
  ScorecardFilters,
  ResolverRelationship,
  ResolverTransition,
  ResolverCommerceFacts,
  ResolverReconciliationRow,
} from '@/lib/scorecard/types'

const TRANSITION_COLUMNS = 'relationship_id, to_stage, occurred_at'

interface TransitionRow {
  relationship_id: string
  to_stage: string
  occurred_at: string
}

export type LoadScorecardResult = { ok: true; scorecard: Scorecard } | { ok: false; error: string }

/**
 * Load + resolve the scorecard for `filters`, as of `now` (defaults to the
 * real clock; a spec/route may pass a fixed instant). `stage`/`steward` push
 * down to SQL via `listAllRelationships` (same as `/api/admin/relationships`);
 * the full filter set (including `stage`/`steward` again, harmlessly) is
 * reapplied by the resolver via `lib/scorecard/filters.ts` — one place, one
 * behavior, verified with no database in `e2e/scorecard-filters.spec.ts`.
 */
export async function loadScorecard(filters: ScorecardFilters, now: Date = new Date()): Promise<LoadScorecardResult> {
  const listResult = await listAllRelationships({ stage: filters.stage, steward: filters.steward })
  if (!listResult.ok) return { ok: false, error: 'No se pudo leer el cohorte.' }

  const enrichResult = await enrichRelationships(listResult.rows, now)
  if (!enrichResult.ok) return { ok: false, error: 'No se pudo calcular el resumen del cohorte.' }

  const relationships: ResolverRelationship[] = enrichResult.relationships.map((r) => ({
    id: r.id,
    businessName: r.businessName,
    stage: r.stage,
    stageEnteredAt: r.stageEnteredAt,
    createdAt: r.createdAt,
    cohort: r.cohort,
    promoterId: r.promoterId,
    stewardClerkUserId: r.stewardClerkUserId,
    shopId: r.shopId,
    ageInStageDays: r.ageInStageDays,
    overdue: r.overdue,
    missingAction: r.missingAction,
  }))

  const ids = relationships.map((r) => r.id)

  let transitions: ResolverTransition[] = []
  let transitionsOk = true
  if (ids.length > 0) {
    const { data, error } = await db.from('merchant_relationship_transitions').select(TRANSITION_COLUMNS).in('relationship_id', ids)
    if (error) {
      transitionsOk = false
    } else {
      transitions = ((data ?? []) as TransitionRow[]).map((t) => ({
        relationshipId: t.relationship_id,
        toStage: t.to_stage,
        occurredAt: t.occurred_at,
      }))
    }
  }

  // Reused, not re-fetched (see file header): loadReconciliationRows() already
  // reads the fresh commerce facts + Golden Beans emission state per
  // relationship in one pass.
  const reconciliationAll = await loadReconciliationRows()
  const idSet = new Set(ids)
  const reconciliationScoped = reconciliationAll.filter((r) => idSet.has(r.id))

  const commerceFacts: ResolverCommerceFacts[] = reconciliationScoped.map((r) => ({
    relationshipId: r.id,
    ok: !r.factsDegraded,
    firstSale: r.sourceFacts.firstSale,
    retained30d: r.sourceFacts.retained30d,
  }))

  const reconciliation: ResolverReconciliationRow[] = reconciliationScoped.map((r) => ({
    relationshipId: r.id,
    projectedStage: r.projectedStage,
    emissions: r.emissions.map((e) => ({ eventType: e.eventType, deliveredAt: e.deliveredAt })),
  }))

  const scorecard = resolveScorecard({
    now,
    filters,
    thresholds: { retentionWindowDays: RETENTION_WINDOW_DAYS, threeProductsThreshold: THREE_PRODUCTS_THRESHOLD },
    relationships,
    relationshipsOk: true,
    transitions,
    transitionsOk,
    commerceFacts,
    reconciliation,
  })

  return { ok: true, scorecard }
}
