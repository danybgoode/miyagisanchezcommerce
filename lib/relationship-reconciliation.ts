/**
 * lib/relationship-reconciliation.ts
 *
 * Founding merchant activation operations · Sprint 3, Story 3.3 — the read
 * side of `/admin/relaciones/conciliacion`: for every relationship, the
 * source commerce fact, the projected stage, the last evaluation timestamp,
 * and the Golden Beans delivery state of its emissions
 * (`pending`/`delivered`/`attempts`/`last_error`).
 *
 * READ-ONLY (build contract: "reconciliation cannot edit Medusa ownership,
 * products, orders or payments"). `loadCommerceFacts` is itself a pure read
 * (Story 3.1's own no-mutation guarantee); this module adds only Supabase
 * `.select()` calls on top. `e2e/relationship-reconciliation.spec.ts` asserts
 * this module's source text, the GET route and the replay route all hold no
 * Medusa write client and no Supabase write verb.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { loadCommerceFacts, type CommerceStageFacts } from '@/lib/merchant-commerce-facts'
import { isStage, type Stage } from '@/lib/merchant-stage'

export interface EmissionState {
  eventType: string
  deliveredAt: string | null
  attempts: number
  lastError: string | null
}

export interface ReconciliationRow {
  id: string
  businessName: string
  /** `merchant_relationships.stage` — this IS the resolver's last-computed
   *  output (D3: stage is derived; `evaluateRelationship` mirrors it here on
   *  every advance), so "projected stage" needs no separate re-derivation to
   *  display. */
  projectedStage: Stage
  lastEvaluatedAt: string | null
  sourceFacts: CommerceStageFacts
  /** False when the FRESH read behind `sourceFacts` (taken right now, for
   *  this view) couldn't complete — distinct from whatever the last sweep
   *  saw. A degraded read here means Medusa is unreachable AT THIS MOMENT,
   *  not that the projected stage above is wrong. */
  factsDegraded: boolean
  emissions: EmissionState[]
}

const RELATIONSHIP_COLUMNS = 'id, business_name, stage, shop_id, last_evaluated_at'

interface RelationshipReconciliationRow {
  id: string
  business_name: string
  stage: string
  shop_id: string | null
  last_evaluated_at: string | null
}

interface EmissionRow {
  merchant_id: string
  event_type: string
  delivered_at: string | null
  attempts: number | null
  last_error: string | null
}

/**
 * The full cohort's reconciliation view. Population-sized for founding
 * merchants (small by definition, same scale assumption `lib/relationship-
 * list.ts#listAllRelationships` already makes) — one batched emissions read
 * and one Medusa read per relationship, not N+1 Supabase round trips.
 */
export async function loadReconciliationRows(): Promise<ReconciliationRow[]> {
  const { data } = await db
    .from('merchant_relationships')
    .select(RELATIONSHIP_COLUMNS)
    .order('created_at', { ascending: false })
  const rows = (data as RelationshipReconciliationRow[] | null) ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const { data: emissionData } = await db
    .from('merchant_lifecycle_emissions')
    .select('merchant_id, event_type, delivered_at, attempts, last_error')
    .in('merchant_id', ids)

  const emissionsByRelationship = new Map<string, EmissionState[]>()
  for (const e of (emissionData as EmissionRow[] | null) ?? []) {
    const list = emissionsByRelationship.get(e.merchant_id) ?? []
    list.push({
      eventType: e.event_type,
      deliveredAt: e.delivered_at,
      attempts: typeof e.attempts === 'number' ? e.attempts : 0,
      lastError: e.last_error,
    })
    emissionsByRelationship.set(e.merchant_id, list)
  }

  const factsResults = await Promise.all(rows.map((r) => loadCommerceFacts({ shopId: r.shop_id })))

  return rows.map((r, i) => ({
    id: r.id,
    businessName: r.business_name,
    projectedStage: isStage(r.stage) ? r.stage : 'scouted',
    lastEvaluatedAt: r.last_evaluated_at,
    sourceFacts: factsResults[i].facts,
    factsDegraded: !factsResults[i].ok,
    emissions: emissionsByRelationship.get(r.id) ?? [],
  }))
}
