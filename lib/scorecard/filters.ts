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

/**
 * Parse the scorecard's URL filter params into a `ScorecardFilters`. Lives
 * here (not in a `route.ts`) so the API route, the CSV export route and the
 * MCP tool all import the ONE parser from a plain lib module — importing a
 * helper across `route.ts` entrypoints risks bundling the route's own
 * exports/config (cross-agent review, PR 307).
 */
export function parseScorecardFilters(url: URL): ScorecardFilters {
  const sp = url.searchParams
  return {
    cohort: sp.get('cohort') || undefined,
    stage: sp.get('stage') || undefined,
    promoter: sp.get('promoter') || undefined,
    steward: sp.get('steward') || undefined,
    dateFrom: sp.get('date_from') || undefined,
    dateTo: sp.get('date_to') || undefined,
  }
}

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
