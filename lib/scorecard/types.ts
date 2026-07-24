/**
 * lib/scorecard/types.ts
 *
 * Merchant activation scorecard · Sprint 1, Story 1.1 — the typed shapes the
 * resolver (Story 1.2), fixtures (this story) and every consumer (endpoint,
 * CSV, agent tool) share. Zero-import beyond `lib/merchant-stage.ts` and
 * `lib/scorecard/dictionary.ts` (both zero-import themselves), so this file
 * — and anything that only imports types from it — stays loadable in the
 * Playwright `api` project.
 *
 * These are the ALREADY-FETCHED inputs the pure resolver takes (Story 1.2's
 * pure/impure split): every DB/Medusa read happens in the impure loader;
 * nothing here performs one.
 */
import type { Stage } from '@/lib/merchant-stage'
import type { MetricValue } from '@/lib/scorecard/dictionary'

export interface ResolverRelationship {
  id: string
  businessName: string
  /** Raw string, not `Stage` — the resolver validates it defensively (the DB
   *  CHECK already constrains this in practice; see `dictionary.ts`'s
   *  `funnel_stage_count` exclusion note). */
  stage: string
  stageEnteredAt: string
  createdAt: string
  cohort: string | null
  promoterId: string | null
  stewardClerkUserId: string | null
  shopId: string | null
  ageInStageDays: number
  overdue: boolean
  missingAction: boolean
}

export interface ResolverTransition {
  relationshipId: string
  toStage: string
  occurredAt: string
}

export interface ResolverCommerceFacts {
  relationshipId: string
  /** False when the underlying `loadCommerceFacts` read for this ONE
   *  relationship did not complete — excludes it from first-sale/retention
   *  denominators rather than reading a false "no sale". */
  ok: boolean
  firstSale?: boolean
  retained30d?: boolean
}

export interface ResolverReconciliationEmission {
  eventType: string
  deliveredAt: string | null
}

export interface ResolverReconciliationRow {
  relationshipId: string
  /** `merchant_relationships.stage` at read time, per
   *  `lib/relationship-reconciliation.ts#ReconciliationRow.projectedStage`. */
  projectedStage: string
  emissions: ResolverReconciliationEmission[]
}

export interface ScorecardFilters {
  cohort?: string
  stage?: string
  promoter?: string
  steward?: string
  /** Inclusive `merchant_relationships.created_at` lower/upper bound, ISO. */
  dateFrom?: string
  dateTo?: string
}

export interface ScorecardThresholds {
  retentionWindowDays: number
  threeProductsThreshold: number
}

export interface ScorecardResolverInput {
  now: Date
  filters: ScorecardFilters
  thresholds: ScorecardThresholds
  relationships: ResolverRelationship[]
  /** False when `listAllRelationships`/`enrichRelationships` failed — every
   *  metric that depends on the cohort degrades to `missing` (SD4). */
  relationshipsOk: boolean
  transitions: ResolverTransition[]
  /** False when the `merchant_relationship_transitions` read failed —
   *  degrades aging/activation-time metrics to `stale`, never silently
   *  drops to an all-open-interval computation without saying so. */
  transitionsOk: boolean
  commerceFacts: ResolverCommerceFacts[]
  reconciliation: ResolverReconciliationRow[]
}

export interface ScorecardFunnelStage {
  stage: Stage
  ordinal: number
  count: MetricValue<number>
  conversionFromPrevious: MetricValue<number>
  agingMedianDays: MetricValue<number>
  agingP90Days: MetricValue<number>
  /** Relationship ids that reached this stage or later — same population the
   *  `count` above sums. Drill-through source (decision 2). */
  drillThroughIds: string[]
}

export interface ScorecardSummary {
  cohortEntry: MetricValue<number>
  overdueCount: MetricValue<number>
  overdueIds: string[]
  missingActionCount: MetricValue<number>
  missingActionIds: string[]
  activationTimeMedianDays: MetricValue<number>
  activationTimeP90Days: MetricValue<number>
  activationIds: string[]
  firstSaleCount: MetricValue<number>
  firstSaleRate: MetricValue<number>
  firstSaleIds: string[]
  retained30dCount: MetricValue<number>
  retained30dRate: MetricValue<number>
  retained30dIds: string[]
}

export interface ScorecardFreshness {
  health: 'ok' | 'stale' | 'missing'
  /** Relationships that reached a gated milestone with no delivered Golden
   *  Beans emission for it — the SD1 freshness diagnostic, never a rewrite
   *  of the canonical stage. */
  staleRelationshipIds: string[]
  checkedCount: number
  asOf: string
}

/** A relationship id → the display fields every drill-through ids array
 *  resolves through, computed ONCE by the resolver so the UI, CSV and agent
 *  tool never re-derive "which business is this id" differently. */
export interface ScorecardMerchantSummary {
  businessName: string
  stage: string
}

export interface Scorecard {
  schemaVersion: number
  generatedAt: string
  timezone: string
  filters: ScorecardFilters
  thresholds: ScorecardThresholds
  summary: ScorecardSummary
  funnel: ScorecardFunnelStage[]
  freshness: ScorecardFreshness
  merchants: Record<string, ScorecardMerchantSummary>
}
