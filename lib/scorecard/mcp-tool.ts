/**
 * lib/scorecard/mcp-tool.ts
 *
 * Merchant activation scorecard · Sprint 2, Story 2.3 — the pure half of the
 * admin agent tool: its JSON-RPC tool definition, and the pure filter/bound
 * parsing the route (`app/api/admin/scorecard/mcp/route.ts`, `server-only`
 * transitively via `lib/relationship-access.ts`) delegates to. Kept
 * separate so `e2e/scorecard-agent-parity.spec.ts` can import the tool's
 * shape with no database — the same reason `lib/scorecard/bound.ts` is its
 * own file rather than living inline in the route.
 */
import type { ScorecardFilters } from '@/lib/scorecard/types'

export const SCORECARD_TOOL_NAME = 'get_activation_scorecard'
export const DEFAULT_MAX_IDS = 100
export const MAX_MAX_IDS = 500

export const SCORECARD_TOOL_DEFINITION = {
  name: SCORECARD_TOOL_NAME,
  description:
    'Ficha de activación de comercios fundadores — embudo, tiempo en etapa, próximas acciones y resultados comerciales, de solo lectura. Usa el mismo resolvedor que la vista de administración y el export CSV.',
  inputSchema: {
    type: 'object',
    properties: {
      cohort: { type: 'string' },
      stage: { type: 'string' },
      promoter: { type: 'string' },
      steward: { type: 'string' },
      date_from: { type: 'string' },
      date_to: { type: 'string' },
      max_ids: { type: 'number', description: `Máximo de ids por lista de desglose (default ${DEFAULT_MAX_IDS}, tope ${MAX_MAX_IDS}).` },
    },
    additionalProperties: false,
  },
} as const

export function parseScorecardMcpFilters(args: Record<string, unknown>): ScorecardFilters {
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)
  return {
    cohort: str(args.cohort),
    stage: str(args.stage),
    promoter: str(args.promoter),
    steward: str(args.steward),
    dateFrom: str(args.date_from),
    dateTo: str(args.date_to),
  }
}

/** Clamp a caller-requested `max_ids` into `[1, MAX_MAX_IDS]`, defaulting to
 *  `DEFAULT_MAX_IDS` for anything non-numeric/non-finite — never lets a
 *  caller request 0 (an empty list would be indistinguishable from "no
 *  drill-through data exists") or an unbounded value. */
export function clampMaxIds(requested: unknown): number {
  const n = typeof requested === 'number' && Number.isFinite(requested) ? requested : DEFAULT_MAX_IDS
  return Math.max(1, Math.min(n, MAX_MAX_IDS))
}
