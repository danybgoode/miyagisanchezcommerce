/**
 * lib/scorecard/resolver.ts
 *
 * Merchant activation scorecard · Sprint 1, Story 1.2 — the pure half of the
 * canonical join (README "Build-time architecture decisions", SD1/SD4).
 * `resolveScorecard` takes ALREADY-FETCHED inputs (`ScorecardResolverInput`,
 * `lib/scorecard/types.ts`) and returns the typed scorecard. It performs NO
 * I/O — the impure loader (`lib/scorecard/loader.ts`) gathers inputs via the
 * reuse seams (`listAllRelationships`, `enrichRelationships`,
 * `merchant_relationship_transitions`, `loadReconciliationRows`) and calls
 * this function. THIS is "the one resolver" decision 2 names: the endpoint
 * (Story 1.3), the CSV export (Story 2.2) and the agent tool (Story 2.3) all
 * call the SAME loader → SAME resolver, never a second computation.
 *
 * SD1 — funnel/conversion/aging/activation-time are derived ONLY from
 * `relationships` (mirrors `merchant_relationships`) and `transitions`
 * (mirrors `merchant_relationship_transitions`); `reconciliation` feeds
 * ONLY the `freshness` diagnostic and the first-sale/retention commerce
 * facts (which `loadReconciliationRows` already reads via
 * `loadCommerceFacts` — reused, not re-fetched). Golden Beans is never the
 * source of a stage/funnel number.
 *
 * SD4 — every `MetricValue` is `okMetric`/`staleMetric`/`missingMetric`
 * (`lib/scorecard/dictionary.ts`); a genuine zero is always `okMetric(0,
 * ...)` and nothing else in this file ever produces that exact shape.
 *
 * Zero-import beyond `lib/merchant-stage.ts`, `lib/scorecard/dictionary.ts`,
 * `lib/scorecard/types.ts` and `lib/scorecard/stats.ts` — all zero-import
 * themselves, so this file (and any spec that imports it) loads in the
 * Playwright `api` project with no database.
 */
import { STAGES, STAGE_ORDINAL, isStage, type Stage } from '@/lib/merchant-stage'
import {
  ACTIVATION_STAGE,
  SCORECARD_SCHEMA_VERSION,
  SCORECARD_TIMEZONE,
  okMetric,
  missingMetric,
  staleMetric,
  type MetricHealth,
  type MetricValue,
} from '@/lib/scorecard/dictionary'
import { median, percentile } from '@/lib/scorecard/stats'
import { applyScorecardFilters } from '@/lib/scorecard/filters'
import type {
  ScorecardResolverInput,
  ResolverRelationship,
  ResolverTransition,
  ResolverReconciliationRow,
  Scorecard,
  ScorecardFunnelStage,
  ScorecardFreshness,
  ScorecardMerchantSummary,
} from '@/lib/scorecard/types'

const DAY_MS = 24 * 60 * 60 * 1000

const SOURCE_RELATIONSHIPS = 'merchant_relationships'
const SOURCE_STAGE = 'merchant_relationships.stage'
const SOURCE_CONVERSION = 'funnel_stage_count ratio'
const SOURCE_AGING = 'merchant_relationship_transitions + merchant_relationships.stage_entered_at'
const SOURCE_ACTIVATION = 'merchant_relationship_transitions'
const SOURCE_OVERDUE = 'relationship-enrich.overdue'
const SOURCE_MISSING_ACTION = 'relationship-enrich.missingAction'
const SOURCE_FIRST_SALE = 'loadCommerceFacts.firstSale'
const SOURCE_RETAINED = 'loadCommerceFacts.retained30d'
const SOURCE_FRESHNESS = 'relationship-reconciliation (merchant_lifecycle_emissions)'

/** Build the per-relationship stage-duration TIMELINE from calendar-time
 *  transitions, and accumulate a per-stage array of durations (days) —
 *  CLOSED intervals from consecutive transitions, plus an OPEN interval
 *  (the relationship's own `ageInStageDays`) for whatever stage it sits in
 *  now. Walked strictly in `occurred_at` order — a corrected (non-ordinal-
 *  monotonic) transition still contributes a real calendar-time duration to
 *  whichever stage it was actually in, never assumed to be ordinal-sorted. */
function buildStageDurations(relationships: ResolverRelationship[], transitionsByRelationship: Map<string, ResolverTransition[]>): Map<Stage, number[]> {
  const byStage = new Map<Stage, number[]>()
  const push = (stage: Stage, days: number) => {
    if (!Number.isFinite(days) || days < 0) return
    const arr = byStage.get(stage) ?? []
    arr.push(days)
    byStage.set(stage, arr)
  }

  for (const r of relationships) {
    const txs = (transitionsByRelationship.get(r.id) ?? [])
      .filter((t) => isStage(t.toStage))
      .slice()
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))

    let prevStage: Stage = 'scouted'
    let prevAtMs = Date.parse(r.createdAt)

    for (const t of txs) {
      const atMs = Date.parse(t.occurredAt)
      if (Number.isFinite(atMs) && Number.isFinite(prevAtMs) && atMs >= prevAtMs) {
        push(prevStage, (atMs - prevAtMs) / DAY_MS)
      }
      prevStage = t.toStage as Stage
      prevAtMs = atMs
    }

    if (isStage(r.stage)) push(r.stage, r.ageInStageDays)
  }

  return byStage
}

function agingForStage(
  stage: Stage,
  durationsByStage: Map<Stage, number[]>,
  relationshipsOk: boolean,
  transitionsOk: boolean,
  asOf: string,
): { median: MetricValue<number>; p90: MetricValue<number> } {
  if (!relationshipsOk) return { median: missingMetric(SOURCE_AGING, asOf), p90: missingMetric(SOURCE_AGING, asOf) }
  const values = durationsByStage.get(stage) ?? []
  if (values.length === 0) return { median: missingMetric(SOURCE_AGING, asOf), p90: missingMetric(SOURCE_AGING, asOf) }
  const medianVal = median(values)!
  const p90Val = percentile(values, 90)!
  if (!transitionsOk) return { median: staleMetric(medianVal, SOURCE_AGING, asOf), p90: staleMetric(p90Val, SOURCE_AGING, asOf) }
  return { median: okMetric(medianVal, SOURCE_AGING, asOf), p90: okMetric(p90Val, SOURCE_AGING, asOf) }
}

function buildFunnel(
  relationships: ResolverRelationship[],
  relationshipsOk: boolean,
  durationsByStage: Map<Stage, number[]>,
  transitionsOk: boolean,
  asOf: string,
): ScorecardFunnelStage[] {
  const stages: ScorecardFunnelStage[] = STAGES.map((stage, i) => {
    const ordinal = i + 1
    const reachedIds = relationshipsOk ? relationships.filter((r) => isStage(r.stage) && STAGE_ORDINAL[r.stage] >= ordinal).map((r) => r.id) : []
    const count = relationshipsOk ? okMetric(reachedIds.length, SOURCE_STAGE, asOf) : missingMetric<number>(SOURCE_STAGE, asOf)
    const aging = agingForStage(stage, durationsByStage, relationshipsOk, transitionsOk, asOf)
    return {
      stage,
      ordinal,
      count,
      conversionFromPrevious: missingMetric<number>(SOURCE_CONVERSION, asOf), // filled below
      agingMedianDays: aging.median,
      agingP90Days: aging.p90,
      drillThroughIds: reachedIds,
    }
  })

  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count
    const cur = stages[i].count
    if (!relationshipsOk || prev.value === null || cur.value === null) {
      stages[i].conversionFromPrevious = missingMetric<number>(SOURCE_CONVERSION, asOf)
    } else if (prev.value === 0) {
      // No denominator — genuinely undefined, never a substituted 0 (SD4).
      stages[i].conversionFromPrevious = missingMetric<number>(SOURCE_CONVERSION, asOf)
    } else {
      stages[i].conversionFromPrevious = okMetric(cur.value / prev.value, SOURCE_CONVERSION, asOf)
    }
  }

  return stages
}

function computeActivationTime(
  relationships: ResolverRelationship[],
  transitionsByRelationship: Map<string, ResolverTransition[]>,
  relationshipsOk: boolean,
  transitionsOk: boolean,
  asOf: string,
): { median: MetricValue<number>; p90: MetricValue<number>; ids: string[] } {
  if (!relationshipsOk) {
    return { median: missingMetric(SOURCE_ACTIVATION, asOf), p90: missingMetric(SOURCE_ACTIVATION, asOf), ids: [] }
  }

  const activationOrdinal = STAGE_ORDINAL[ACTIVATION_STAGE]
  const eligible = relationships.filter((r) => isStage(r.stage) && STAGE_ORDINAL[r.stage] >= activationOrdinal)

  const durations: number[] = []
  const ids: string[] = []
  for (const r of eligible) {
    const txs = transitionsByRelationship.get(r.id) ?? []
    const hit = txs.find((t) => t.toStage === ACTIVATION_STAGE)
    if (!hit) continue
    const days = (Date.parse(hit.occurredAt) - Date.parse(r.createdAt)) / DAY_MS
    if (Number.isFinite(days) && days >= 0) {
      durations.push(days)
      ids.push(r.id)
    }
  }

  if (durations.length === 0) {
    // `eligible.length > 0` means the canonical stage says someone got there
    // but no matching transition row was found — a coverage gap, distinct
    // from "genuinely nobody has activated yet".
    const health: MetricHealth = eligible.length > 0 ? 'stale' : 'missing'
    const build = health === 'stale' ? staleMetric<number>(null, SOURCE_ACTIVATION, asOf) : missingMetric<number>(SOURCE_ACTIVATION, asOf)
    return { median: build, p90: build, ids: [] }
  }

  const medianVal = median(durations)!
  const p90Val = percentile(durations, 90)!
  const ok = transitionsOk && durations.length >= eligible.length
  return {
    median: ok ? okMetric(medianVal, SOURCE_ACTIVATION, asOf) : staleMetric(medianVal, SOURCE_ACTIVATION, asOf),
    p90: ok ? okMetric(p90Val, SOURCE_ACTIVATION, asOf) : staleMetric(p90Val, SOURCE_ACTIVATION, asOf),
    ids,
  }
}

function computeCommerceOutcome(
  relationships: ResolverRelationship[],
  commerceFactsByRelationship: Map<string, { ok: boolean; value?: boolean }>,
  relationshipsOk: boolean,
  source: string,
  asOf: string,
): { count: MetricValue<number>; rate: MetricValue<number>; ids: string[] } {
  if (!relationshipsOk) {
    return { count: missingMetric(source, asOf), rate: missingMetric(source, asOf), ids: [] }
  }

  const eligible = relationships.filter((r) => r.shopId !== null)
  if (eligible.length === 0) {
    return { count: missingMetric(source, asOf), rate: missingMetric(source, asOf), ids: [] }
  }

  const usable = eligible.filter((r) => commerceFactsByRelationship.get(r.id)?.ok === true)
  if (usable.length === 0) {
    return { count: staleMetric<number>(null, source, asOf), rate: staleMetric<number>(null, source, asOf), ids: [] }
  }

  const trueIds = usable.filter((r) => commerceFactsByRelationship.get(r.id)?.value === true).map((r) => r.id)
  const ok = usable.length >= eligible.length
  const countVal = trueIds.length
  const rateVal = trueIds.length / usable.length
  return {
    count: ok ? okMetric(countVal, source, asOf) : staleMetric(countVal, source, asOf),
    rate: ok ? okMetric(rateVal, source, asOf) : staleMetric(rateVal, source, asOf),
    ids: trueIds,
  }
}

/**
 * SD1's freshness diagnostic: for every relationship that reached a GATED
 * milestone (ordinal > 1 — `scouted` has no hito to emit), does a DELIVERED
 * Golden Beans emission exist for it? A gap flags the relationship as
 * `stale` here without touching its canonical `projectedStage`.
 *
 * `loadReconciliationRows()` (the underlying read) has no `ok` flag of its
 * own — a Supabase error on its first query silently returns `[]` rather
 * than surfacing a failure (a known limitation of that reused module, not
 * fixed here — it is imported unchanged, "reuse, don't rebuild"). This
 * function treats an EMPTY reconciliation result as suspicious — and
 * degrades to `missing` — only when the relationship population itself is
 * non-empty; an empty cohort with an empty reconciliation result is the
 * expected, correct pairing.
 */
function computeFreshness(
  reconciliation: ResolverReconciliationRow[],
  relationshipsOk: boolean,
  relationshipsCount: number,
  asOf: string,
): ScorecardFreshness {
  if (!relationshipsOk) {
    return { health: 'missing', staleRelationshipIds: [], checkedCount: 0, asOf }
  }
  if (reconciliation.length === 0 && relationshipsCount > 0) {
    return { health: 'missing', staleRelationshipIds: [], checkedCount: 0, asOf }
  }

  const staleIds: string[] = []
  for (const row of reconciliation) {
    if (!isStage(row.projectedStage)) continue
    if (STAGE_ORDINAL[row.projectedStage] <= 1) continue
    const expectedEvent = `merchant.${row.projectedStage}`
    const delivered = row.emissions.some((e) => e.eventType === expectedEvent && e.deliveredAt !== null)
    if (!delivered) staleIds.push(row.relationshipId)
  }

  return {
    health: staleIds.length > 0 ? 'stale' : 'ok',
    staleRelationshipIds: staleIds,
    checkedCount: reconciliation.length,
    asOf,
  }
}

export function resolveScorecard(input: ScorecardResolverInput): Scorecard {
  const { now, filters, thresholds, transitions, transitionsOk, commerceFacts, reconciliation } = input
  const asOf = now.toISOString()

  const relationships = applyScorecardFilters(input.relationships, filters)
  const relationshipsOk = input.relationshipsOk

  const transitionsByRelationship = new Map<string, ResolverTransition[]>()
  for (const t of transitions) {
    const arr = transitionsByRelationship.get(t.relationshipId) ?? []
    arr.push(t)
    transitionsByRelationship.set(t.relationshipId, arr)
  }

  const firstSaleFactsByRelationship = new Map<string, { ok: boolean; value?: boolean }>()
  const retainedFactsByRelationship = new Map<string, { ok: boolean; value?: boolean }>()
  for (const c of commerceFacts) {
    firstSaleFactsByRelationship.set(c.relationshipId, { ok: c.ok, value: c.firstSale })
    retainedFactsByRelationship.set(c.relationshipId, { ok: c.ok, value: c.retained30d })
  }

  const durationsByStage = buildStageDurations(relationships, transitionsByRelationship)
  const funnel = buildFunnel(relationships, relationshipsOk, durationsByStage, transitionsOk, asOf)

  const cohortEntry = relationshipsOk ? okMetric(relationships.length, SOURCE_RELATIONSHIPS, asOf) : missingMetric<number>(SOURCE_RELATIONSHIPS, asOf)

  const overdueIds = relationshipsOk ? relationships.filter((r) => r.overdue).map((r) => r.id) : []
  const missingActionIds = relationshipsOk ? relationships.filter((r) => r.missingAction).map((r) => r.id) : []

  const activation = computeActivationTime(relationships, transitionsByRelationship, relationshipsOk, transitionsOk, asOf)
  const firstSale = computeCommerceOutcome(relationships, firstSaleFactsByRelationship, relationshipsOk, SOURCE_FIRST_SALE, asOf)
  const retained = computeCommerceOutcome(
    relationships,
    retainedFactsByRelationship,
    relationshipsOk,
    `${SOURCE_RETAINED} (window=${thresholds.retentionWindowDays}d)`,
    asOf,
  )

  const filteredIds = new Set(relationships.map((r) => r.id))
  const scopedReconciliation = reconciliation.filter((r) => filteredIds.has(r.relationshipId))
  const freshness = computeFreshness(scopedReconciliation, relationshipsOk, relationships.length, asOf)

  const merchants: Record<string, ScorecardMerchantSummary> = {}
  for (const r of relationships) merchants[r.id] = { businessName: r.businessName, stage: r.stage }

  return {
    schemaVersion: SCORECARD_SCHEMA_VERSION,
    generatedAt: asOf,
    timezone: SCORECARD_TIMEZONE,
    filters,
    thresholds,
    summary: {
      cohortEntry,
      overdueCount: relationshipsOk ? okMetric(overdueIds.length, SOURCE_OVERDUE, asOf) : missingMetric<number>(SOURCE_OVERDUE, asOf),
      overdueIds,
      missingActionCount: relationshipsOk ? okMetric(missingActionIds.length, SOURCE_MISSING_ACTION, asOf) : missingMetric<number>(SOURCE_MISSING_ACTION, asOf),
      missingActionIds,
      activationTimeMedianDays: activation.median,
      activationTimeP90Days: activation.p90,
      activationIds: activation.ids,
      firstSaleCount: firstSale.count,
      firstSaleRate: firstSale.rate,
      firstSaleIds: firstSale.ids,
      retained30dCount: retained.count,
      retained30dRate: retained.rate,
      retained30dIds: retained.ids,
    },
    funnel,
    freshness,
    merchants,
  }
}

export type {
  ScorecardResolverInput,
  ScorecardFilters,
  ScorecardThresholds,
  Scorecard,
  ScorecardFunnelStage,
  ScorecardSummary,
  ScorecardFreshness,
  ScorecardMerchantSummary,
  ResolverRelationship,
  ResolverTransition,
  ResolverCommerceFacts,
  ResolverReconciliationRow,
} from '@/lib/scorecard/types'
