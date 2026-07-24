/**
 * lib/scorecard/csv.ts
 *
 * Merchant activation scorecard · Sprint 2, Story 2.2 — a pure serializer
 * from the resolver's own `Scorecard` output to CSV. Zero-import beyond
 * `lib/scorecard/types.ts`, so `e2e/scorecard-csv.spec.ts` can round-trip a
 * fixture-derived `Scorecard` through this with no database and assert the
 * CSV totals match the SAME object the UI/agent would render (decision 2 —
 * "exports use the same resolver").
 *
 * Contact PII (phone/email/whatsapp/instagram) is structurally impossible to
 * leak here — `ResolverRelationship`/`Scorecard` never carry those fields at
 * all (Story 1.2's loader maps only the columns the resolver needs). Every
 * merchant row this file emits is `id, business_name, stage` — the same
 * subset `/admin/relaciones`'s own list view already shows an admin.
 */
import type { Scorecard } from '@/lib/scorecard/types'
import type { MetricValue } from '@/lib/scorecard/dictionary'

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function csvRow(cells: Array<string | number>): string {
  return cells.map((c) => csvCell(String(c))).join(',') + '\r\n'
}

function metricCells(m: MetricValue<number>): [string, string] {
  return [m.value === null ? '' : String(m.value), m.health]
}

/**
 * The full CSV: a metadata header block (schema version, generation/freshness
 * timestamps, active filters), the summary metrics, the 13-row funnel table,
 * and one drill-through row per merchant id the resolver returned across
 * every metric — so "row/count totals match the UI" is literally checkable
 * by counting rows against each metric's `value`.
 */
export function scorecardToCsv(scorecard: Scorecard): string {
  let out = ''

  out += csvRow(['schema_version', 'generated_at', 'timezone'])
  out += csvRow([scorecard.schemaVersion, scorecard.generatedAt, scorecard.timezone])
  out += '\r\n'

  out += csvRow(['filter', 'value'])
  out += csvRow(['cohort', scorecard.filters.cohort ?? ''])
  out += csvRow(['stage', scorecard.filters.stage ?? ''])
  out += csvRow(['promoter', scorecard.filters.promoter ?? ''])
  out += csvRow(['steward', scorecard.filters.steward ?? ''])
  out += csvRow(['date_from', scorecard.filters.dateFrom ?? ''])
  out += csvRow(['date_to', scorecard.filters.dateTo ?? ''])
  out += '\r\n'

  out += csvRow(['threshold', 'value'])
  out += csvRow(['retention_window_days', scorecard.thresholds.retentionWindowDays])
  out += csvRow(['three_products_threshold', scorecard.thresholds.threeProductsThreshold])
  out += '\r\n'

  out += csvRow(['freshness_health', 'freshness_checked_count', 'freshness_stale_count', 'freshness_as_of'])
  out += csvRow([scorecard.freshness.health, scorecard.freshness.checkedCount, scorecard.freshness.staleRelationshipIds.length, scorecard.freshness.asOf])
  out += '\r\n'

  out += csvRow(['metric', 'value', 'health'])
  const summaryRows: Array<[string, MetricValue<number>]> = [
    ['cohort_entry', scorecard.summary.cohortEntry],
    ['overdue_count', scorecard.summary.overdueCount],
    ['missing_action_count', scorecard.summary.missingActionCount],
    ['activation_time_median_days', scorecard.summary.activationTimeMedianDays],
    ['activation_time_p90_days', scorecard.summary.activationTimeP90Days],
    ['first_sale_count', scorecard.summary.firstSaleCount],
    ['first_sale_rate', scorecard.summary.firstSaleRate],
    ['retained_30d_count', scorecard.summary.retained30dCount],
    ['retained_30d_rate', scorecard.summary.retained30dRate],
  ]
  for (const [id, metric] of summaryRows) {
    const [value, health] = metricCells(metric)
    out += csvRow([id, value, health])
  }
  out += '\r\n'

  out += csvRow(['stage', 'ordinal', 'count', 'count_health', 'conversion_from_previous', 'conversion_health', 'age_median_days', 'age_median_health', 'age_p90_days', 'age_p90_health'])
  for (const row of scorecard.funnel) {
    const [countVal, countHealth] = metricCells(row.count)
    const [convVal, convHealth] = metricCells(row.conversionFromPrevious)
    const [medVal, medHealth] = metricCells(row.agingMedianDays)
    const [p90Val, p90Health] = metricCells(row.agingP90Days)
    out += csvRow([row.stage, row.ordinal, countVal, countHealth, convVal, convHealth, medVal, medHealth, p90Val, p90Health])
  }
  out += '\r\n'

  out += csvRow(['drill_through_metric', 'relationship_id', 'business_name', 'stage'])
  const drillThroughGroups: Array<[string, string[]]> = [
    ['overdue', scorecard.summary.overdueIds],
    ['missing_action', scorecard.summary.missingActionIds],
    ['activation_time', scorecard.summary.activationIds],
    ['first_sale', scorecard.summary.firstSaleIds],
    ['retained_30d', scorecard.summary.retained30dIds],
    ...scorecard.funnel.map((f): [string, string[]] => [`funnel_${f.stage}`, f.drillThroughIds]),
  ]
  for (const [metricId, ids] of drillThroughGroups) {
    for (const id of ids) {
      const m = scorecard.merchants[id]
      out += csvRow([metricId, id, m?.businessName ?? '', m?.stage ?? ''])
    }
  }

  return out
}
