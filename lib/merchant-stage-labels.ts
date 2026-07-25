/**
 * lib/merchant-stage-labels.ts
 *
 * The es-MX display label for each of the 13 canonical lifecycle stages.
 *
 * EXTRACTED (Merchant Partner lifecycle · Sprint 1, Story 1.2) from
 * `app/components/RelationshipHistoryPanel.tsx`, which still re-exports it for
 * its existing consumers. It had to move for two reasons:
 *
 *   1. That file is a `'use client'` module. A SERVER component (the `/partner`
 *      portfolio section) cannot read a plain-object export out of a client
 *      module — it would get a client reference, not the map.
 *   2. Copying the labels into a second file would fork them, and a forked
 *      label map drifts exactly the way a forked contract does (LEARNINGS: "a
 *      paraphrased contract drifts permissive — cite the source, don't restate
 *      it"). One definition, imported by both.
 *
 * Typed `Record<Stage, string>`, so adding a 14th stage to
 * `lib/merchant-stage.ts#STAGES` fails `tsc` here rather than silently
 * rendering a raw English slug at a Spanish-only surface (AGENTS rule #5).
 *
 * Zero-import beyond `lib/merchant-stage.ts` (itself zero-import), so an `api`
 * spec can load it with no database.
 */
import type { Stage } from '@/lib/merchant-stage'

/** Exhaustiveness is enforced HERE, by the `Record<Stage, …>` type: adding a
 *  14th stage without a label fails `tsc`. The public export below widens the
 *  KEY type to `string` so existing callers can keep indexing it with a raw DB
 *  value — widening the key never weakens the exhaustiveness check above. */
const STAGE_LABEL_BY_STAGE: Record<Stage, string> = {
  scouted: 'Detectado',
  qualified: 'Calificado',
  permission_granted: 'Permiso otorgado',
  preview_in_preparation: 'Vista previa en preparación',
  preview_delivered: 'Vista previa entregada',
  activation_scheduled: 'Activación agendada',
  claimed: 'Tienda reclamada',
  payments_ready: 'Pagos listos',
  three_products_live: '3+ productos publicados',
  shared_externally: 'Compartido externamente',
  first_inquiry: 'Primera consulta',
  first_sale: 'Primera venta',
  retained_30d: 'Retenido a 30 días',
}

export const STAGE_LABEL: Readonly<Record<string, string>> = STAGE_LABEL_BY_STAGE

/** The label for a raw stage string, falling back to the string itself for a
 *  value the DB CHECK would already have rejected. */
export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage
}
