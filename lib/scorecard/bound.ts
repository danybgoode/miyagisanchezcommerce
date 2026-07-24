/**
 * lib/scorecard/bound.ts
 *
 * Merchant activation scorecard · Sprint 2, Story 2.3 — bounds every
 * drill-through id array in a `Scorecard` to `maxIds`, for the agent tool's
 * "bounded/paginated" requirement. Pure and zero-import beyond
 * `lib/scorecard/types.ts`, so `e2e/scorecard-agent-parity.spec.ts` can
 * assert the ONE invariant that makes this safe to ship: bounding NEVER
 * changes a metric's `value`/`health` — only how many ids are listed
 * alongside it. That is what lets the UI (unbounded) and the agent tool
 * (bounded) agree on every number while differing only in list length —
 * the "UI/API/agent fixture comparisons agree" acceptance (Story 2.3).
 */
import type { Scorecard, ScorecardFunnelStage } from '@/lib/scorecard/types'

export interface BoundedIdList {
  ids: string[]
  total: number
  truncated: boolean
}

export interface BoundedScorecard extends Omit<Scorecard, 'summary' | 'funnel'> {
  summary: Omit<Scorecard['summary'], 'overdueIds' | 'missingActionIds' | 'activationIds' | 'firstSaleIds' | 'retained30dIds'> & {
    overdueIds: BoundedIdList
    missingActionIds: BoundedIdList
    activationIds: BoundedIdList
    firstSaleIds: BoundedIdList
    retained30dIds: BoundedIdList
  }
  funnel: Array<Omit<ScorecardFunnelStage, 'drillThroughIds'> & { drillThroughIds: BoundedIdList }>
}

function bound(ids: string[], maxIds: number): BoundedIdList {
  return { ids: ids.slice(0, maxIds), total: ids.length, truncated: ids.length > maxIds }
}

export function boundScorecard(scorecard: Scorecard, maxIds: number): BoundedScorecard {
  return {
    ...scorecard,
    summary: {
      ...scorecard.summary,
      overdueIds: bound(scorecard.summary.overdueIds, maxIds),
      missingActionIds: bound(scorecard.summary.missingActionIds, maxIds),
      activationIds: bound(scorecard.summary.activationIds, maxIds),
      firstSaleIds: bound(scorecard.summary.firstSaleIds, maxIds),
      retained30dIds: bound(scorecard.summary.retained30dIds, maxIds),
    },
    funnel: scorecard.funnel.map((f) => ({ ...f, drillThroughIds: bound(f.drillThroughIds, maxIds) })),
  }
}
