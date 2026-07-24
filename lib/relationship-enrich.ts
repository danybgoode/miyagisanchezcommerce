/**
 * lib/relationship-enrich.ts
 *
 * Founding merchant activation operations · Sprint 2 (Story 2.3) — turns a
 * batch of raw `merchant_relationships` rows into the view-ready shape the
 * promoter/admin operating views need: age in stage, next action (or the
 * "sin próxima acción" condition), overdue, blocker, and a light consent
 * summary. Composes the pure `lib/relationship-pipeline.ts` with TWO batched
 * reads (open tasks, preview status) instead of one query per row — the
 * populations here are small (founding-merchant scale), but N+1 is still
 * worth avoiding for free.
 *
 * `consentState` is deliberately a light read of `merchant_previews.status`
 * only, NOT a full `readApprovalState` (staleness needs the live product
 * snapshot re-hashed per preview — real work, appropriate for the single-
 * relationship consent route, not a list of dozens of rows). A list row
 * shows "hay una vista previa, y su estatus es X"; the full staleness/
 * verification detail is what the consent route + Sprint 1's evidence rules
 * already own.
 *
 * FAIL-CLOSED ON READ ERRORS (C3, PR 304 review): the ORIGINAL version
 * discarded the two batched-read errors (`const { data } = await db...`),
 * so a failed OPEN-TASKS query silently produced an empty task map — every
 * row then read `missingAction: true`, a false operational claim ("this
 * merchant has no next action") manufactured from a DB hiccup, not from the
 * data. `enrichRelationships` now returns `{ ok: false }` on either read
 * failing, and the caller turns that into a 500 rather than a confidently
 * wrong 200. This is the SAME rule `lib/merchant-stage.ts`'s resolver already
 * applies (unknown facts decline, never grant) — a `RelationshipRow`'s
 * derived VIEW fields must fail exactly as closed as its derived STAGE does.
 *
 * Runtime: Node only (Supabase service-role client).
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { toRelationshipDTO, type RelationshipRow, type RelationshipDTO } from '@/lib/relationship-access'
import { nextOpenTask, isMissingAction, isOverdue, ageInStageDays, hasBlocker, type OpenTaskFact } from '@/lib/relationship-pipeline'

export type ConsentState =
  | 'sin_vista_previa'
  | 'vista_previa_draft'
  | 'vista_previa_approved'
  | 'vista_previa_changes_requested'
  | 'vista_previa_invalidated'
  | 'vista_previa_activated'

export interface EnrichedRelationship extends RelationshipDTO {
  ageInStageDays: number
  nextAction: OpenTaskFact | null
  missingAction: boolean
  overdue: boolean
  blocker: boolean
  consentState: ConsentState
}

function consentStateFor(previewId: string | null, statusById: Map<string, string>): ConsentState {
  if (!previewId) return 'sin_vista_previa'
  const status = statusById.get(previewId)
  if (status === 'approved') return 'vista_previa_approved'
  if (status === 'changes_requested') return 'vista_previa_changes_requested'
  if (status === 'invalidated') return 'vista_previa_invalidated'
  if (status === 'activated') return 'vista_previa_activated'
  if (status === 'draft') return 'vista_previa_draft'
  return 'sin_vista_previa'
}

export type EnrichResult = { ok: true; relationships: EnrichedRelationship[] } | { ok: false }

export async function enrichRelationships(rows: RelationshipRow[], now: Date): Promise<EnrichResult> {
  const ids = rows.map((r) => r.id)

  const openTasksByRelationship = new Map<string, OpenTaskFact[]>()
  if (ids.length > 0) {
    const { data, error } = await db
      .from('merchant_relationship_tasks')
      .select('id, relationship_id, due_at')
      .is('completed_at', null)
      .in('relationship_id', ids)
    if (error) return { ok: false }
    for (const t of (data ?? []) as Array<{ id: string; relationship_id: string; due_at: string | null }>) {
      const arr = openTasksByRelationship.get(t.relationship_id) ?? []
      arr.push({ id: t.id, dueAt: t.due_at })
      openTasksByRelationship.set(t.relationship_id, arr)
    }
  }

  const previewIds = Array.from(new Set(rows.map((r) => r.preview_id).filter((x): x is string => !!x)))
  const previewStatusById = new Map<string, string>()
  if (previewIds.length > 0) {
    const { data, error } = await db.from('merchant_previews').select('id, status').in('id', previewIds)
    if (error) return { ok: false }
    for (const p of (data ?? []) as Array<{ id: string; status: string }>) previewStatusById.set(p.id, p.status)
  }

  const relationships = rows.map((row) => {
    const openTasks = openTasksByRelationship.get(row.id) ?? []
    const next = nextOpenTask(openTasks)
    return {
      ...toRelationshipDTO(row),
      ageInStageDays: ageInStageDays(row.stage_entered_at, now),
      nextAction: next,
      missingAction: isMissingAction(openTasks),
      overdue: isOverdue(next, now),
      blocker: hasBlocker(row.objections),
      consentState: consentStateFor(row.preview_id, previewStatusById),
    }
  })

  return { ok: true, relationships }
}
