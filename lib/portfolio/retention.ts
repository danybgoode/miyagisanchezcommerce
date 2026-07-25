/**
 * lib/portfolio/retention.ts
 *
 * Merchant Partner lifecycle · Sprint 3, Story 3.1 — the PURE half of the
 * 30-day retention check-in (README D7). ZERO-IMPORT beyond
 * `lib/scorecard/dictionary.ts` (itself zero-import beyond
 * `lib/merchant-stage.ts`), so an `api` Playwright spec loads this file with
 * no database.
 *
 * D7 — THE TASK HANGS OFF THE `first_sale` TRANSITION, NOT AN ORDER.
 * `evaluateRelationship` (`lib/merchant-relationship-lifecycle.ts`) already
 * writes that transition idempotently under `UNIQUE (relationship_id,
 * dedupe_key)`. `retentionDedupeKey` below is the SEPARATE idempotency key
 * for the TASK this sprint schedules off that row — the impure
 * `retention-server.ts` sibling reads the transition's earliest
 * `to_stage = 'first_sale'` row and calls `retentionDueAt` with the window
 * as a PARAMETER (never a constant duplicated here: `RETENTION_WINDOW_DAYS`
 * lives in `lib/merchant-medusa-reads.ts`, `server-only`-tainted — the exact
 * precedent `lib/merchant-lifecycle.ts#deriveSaleFacts` and
 * `lib/scorecard/dictionary.ts` both already set for this same problem).
 *
 * `isAllowedOutcome` imports `lib/scorecard/dictionary.ts#RETENTION_OUTCOMES`
 * BY REFERENCE — this file defines no outcome vocabulary of its own.
 */
import { isRetentionOutcome, type RetentionOutcome } from '@/lib/scorecard/dictionary'

export type { RetentionOutcome }
export { isRetentionOutcome as isAllowedOutcome }

/**
 * The natural dedupe key for the ONE retention task a relationship may ever
 * have — reusing it for the same relationship twice hits the migration's
 * partial `UNIQUE (relationship_id, dedupe_key) WHERE dedupe_key IS NOT
 * NULL` and inserts nothing the second time. Namespaced with the task kind
 * (mirrors `lib/merchant-stage.ts#correctionDedupeKey`'s
 * `correction:<id>` shape) so a future additive dedupe-keyed task kind can
 * never collide with this one even though the UNIQUE constraint is already
 * scoped per-relationship.
 */
export function retentionDedupeKey(relationshipId: string): string {
  return `retention_30d:${relationshipId}`
}

/**
 * `firstSaleAt + retentionWindowMs`, as an ISO instant. `retentionWindowMs`
 * is the caller's own computed window (`RETENTION_WINDOW_DAYS * 86_400_000`)
 * — this function has no opinion on how long the window is, only on the
 * arithmetic once given one.
 */
export function retentionDueAt(firstSaleAt: Date, retentionWindowMs: number): string {
  return new Date(firstSaleAt.getTime() + retentionWindowMs).toISOString()
}
