/**
 * lib/scorecard/filters.ts
 *
 * Merchant activation scorecard · Sprint 1, Story 1.2 — the pure filter
 * predicate every scorecard surface applies to the fetched relationship
 * population BEFORE handing it to the resolver. `stage`/`steward` are ALSO
 * pushed down to SQL by the impure loader (`lib/relationship-list.ts
 * #listAllRelationships`, same as `/api/admin/relationships`) for query
 * efficiency — reapplying them here is a harmless, idempotent safety net
 * that also makes this the ONE place every filter combination is testable
 * with no database (Sprint QA: "filter combinations").
 */
import type { ResolverRelationship, ScorecardFilters } from '@/lib/scorecard/types'

export function applyScorecardFilters(rows: ResolverRelationship[], filters: ScorecardFilters): ResolverRelationship[] {
  let out = rows
  if (filters.cohort) out = out.filter((r) => r.cohort === filters.cohort)
  if (filters.stage) out = out.filter((r) => r.stage === filters.stage)
  if (filters.promoter) out = out.filter((r) => r.promoterId === filters.promoter)
  if (filters.steward) out = out.filter((r) => r.stewardClerkUserId === filters.steward)
  if (filters.dateFrom) {
    const from = filters.dateFrom
    out = out.filter((r) => r.createdAt >= from)
  }
  if (filters.dateTo) {
    const to = filters.dateTo
    out = out.filter((r) => r.createdAt <= to)
  }
  return out
}
