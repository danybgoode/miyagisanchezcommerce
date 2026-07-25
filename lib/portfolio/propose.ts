/**
 * lib/portfolio/propose.ts
 *
 * Merchant Partner lifecycle · Sprint 3, Story 3.2 — the PURE half of the
 * partner-agent propose/confirm boundary. ZERO-IMPORT: no `server-only`, no
 * `next/*`, no Clerk, no Supabase, so an `api` Playwright spec loads this
 * file with no database.
 *
 * THE PROPOSE/CONFIRM BOUNDARY IS STRUCTURAL (build contract). A proposal
 * is inert JSON until `confirm_task_update` re-runs `resolveRelationshipAccess`
 * + `canWriteRelationship` against the CONFIRMING credential
 * (`lib/portfolio/propose-server.ts`) — it never trusts the proposal's own
 * scope. This file's ONLY job is deciding what a proposal payload may
 * contain: `TASK_UPDATE_FIELDS` below is an explicit POSITIVE list — `title`,
 * `dueAt`, `outcome`, `completedAt`, and an optional interaction append.
 * There is no code path here by which `steward_clerk_user_id`, `promoter_id`,
 * `cohort` or `shop_id` could enter a parsed payload: `parseTaskUpdateProposal`
 * never spreads the raw input, it names each allowed key one at a time.
 * `e2e/portfolio-partner-mcp.spec.ts` asserts those four forbidden fields
 * (derived from `lib/relationship-access.ts#AUDITED_FIELDS` plus the
 * stewardship columns, same technique `e2e/portfolio-reassign.spec.ts`
 * already uses for Story 1.3) are absent from both this file's exported
 * field list AND the confirm writer's actual `.update()` calls.
 *
 * A CONFIRMATION CANNOT MUTATE COMMERCE OR SEND ANYTHING (build contract):
 * the allowed field set touches only `merchant_relationship_tasks` columns
 * and an optional `merchant_relationship_interactions` append — no module
 * this file's population feeds imports `@/lib/medusa` or any transport
 * (`lib/notify.ts`/`lib/email.ts`/`lib/telegram.ts`/
 * `lib/notifications/dispatch.ts`), asserted mechanically alongside the rest
 * of `lib/portfolio/` in `e2e/portfolio-retention.spec.ts`'s population
 * guard.
 */
// `lib/relationship-pipeline.ts` is itself zero-import, so this file still loads
// in the Playwright `api` project with no database.
import { dueAtIsoFromDateOnly, isDateOnlyShape } from '@/lib/relationship-pipeline'

/** The task-row fields a confirmed proposal may write, plus the ONE
 *  optional interaction-append action. Exported as data so the spec derives
 *  its assertions from this array rather than a hand-typed list living only
 *  in the spec. */
export const PROPOSAL_TASK_FIELDS = ['title', 'dueAt', 'outcome', 'completedAt', 'interactionNote'] as const
export type ProposalTaskField = (typeof PROPOSAL_TASK_FIELDS)[number]

/**
 * A proposed task update. `taskId` absent ⇒ CREATE a new open task (a
 * `title` is then required); `taskId` present ⇒ update/complete that
 * existing task. `interactionNote`, when present, appends ONE
 * `merchant_relationship_interactions` row of `kind: 'note'` — it is never
 * sent anywhere; it is a log entry, exactly like a human typing a note in
 * the UI.
 */
export interface TaskUpdateProposal {
  taskId?: string
  title?: string
  dueAt?: string | null
  outcome?: string
  completedAt?: string
  interactionNote?: string
}

export type ProposalParseResult = { ok: true; payload: TaskUpdateProposal } | { ok: false; error: string }

/**
 * Validate + narrow a raw JSON-RPC tool argument into a `TaskUpdateProposal`.
 * A POSITIVE-LIST parser: every accepted key is checked and copied
 * individually; an unknown key on the input is silently dropped, never
 * carried through into the stored payload — there is no `...raw` spread
 * anywhere in this function.
 */
export function parseTaskUpdateProposal(raw: unknown): ProposalParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Propuesta inválida.' }
  }
  const r = raw as Record<string, unknown>
  const payload: TaskUpdateProposal = {}

  if (r.taskId !== undefined) {
    if (typeof r.taskId !== 'string' || !r.taskId.trim()) return { ok: false, error: 'taskId inválido.' }
    payload.taskId = r.taskId.trim()
  }
  if (r.title !== undefined) {
    if (typeof r.title !== 'string' || !r.title.trim()) return { ok: false, error: 'title inválido.' }
    payload.title = r.title.trim()
  }
  if (r.dueAt !== undefined) {
    if (r.dueAt !== null && typeof r.dueAt !== 'string') return { ok: false, error: 'dueAt inválido.' }
    // NORMALIZED AND CALENDAR-VALIDATED HERE, not just type-checked (cross-agent
    // review round 2, PR 311). Type-checking alone let `"not-a-date"` through
    // propose; confirm then CLAIMED the proposal (correctly, to make apply
    // single-shot) and the task UPDATE failed — burning the proposal permanently,
    // since every retry then hits the 409. A garbage date became a lost update.
    //
    // Uses the SAME shipped helpers as `POST .../task` and the task-complete route
    // (`isDateOnlyShape` + `dueAtIsoFromDateOnly`), so the `<input type="date">`
    // date-only case gets the Mexico-City end-of-day treatment and a calendar-
    // invalid value like `2026-02-31` is REJECTED rather than silently rolled into
    // March. Never re-derived here.
    if (typeof r.dueAt === 'string' && r.dueAt !== '') {
      if (isDateOnlyShape(r.dueAt)) {
        const iso = dueAtIsoFromDateOnly(r.dueAt)
        if (!iso) return { ok: false, error: 'dueAt inválido.' }
        payload.dueAt = iso
      } else {
        const d = new Date(r.dueAt)
        if (Number.isNaN(d.getTime())) return { ok: false, error: 'dueAt inválido.' }
        payload.dueAt = d.toISOString()
      }
    } else {
      payload.dueAt = r.dueAt
    }
  }
  if (r.outcome !== undefined) {
    if (typeof r.outcome !== 'string' || !r.outcome) return { ok: false, error: 'outcome inválido.' }
    payload.outcome = r.outcome
  }
  if (r.completedAt !== undefined) {
    if (typeof r.completedAt !== 'string' || !r.completedAt) return { ok: false, error: 'completedAt inválido.' }
    // Same reasoning as `dueAt` above — a garbage instant here reached the DB and
    // burned the claimed proposal.
    const completed = new Date(r.completedAt)
    if (Number.isNaN(completed.getTime())) return { ok: false, error: 'completedAt inválido.' }
    payload.completedAt = completed.toISOString()
  }
  if (r.interactionNote !== undefined) {
    if (typeof r.interactionNote !== 'string' || !r.interactionNote.trim()) {
      return { ok: false, error: 'interactionNote inválido.' }
    }
    payload.interactionNote = r.interactionNote.trim()
  }

  // Creating a new task (no taskId) with no title is a proposal with
  // nothing to name — reject rather than silently insert an untitled row.
  if (payload.taskId === undefined && payload.title === undefined) {
    return { ok: false, error: 'Una propuesta para crear una acción requiere title.' }
  }

  const hasAnyChange =
    payload.title !== undefined ||
    payload.dueAt !== undefined ||
    payload.outcome !== undefined ||
    payload.completedAt !== undefined ||
    payload.interactionNote !== undefined
  if (!hasAnyChange) {
    return { ok: false, error: 'La propuesta no contiene ningún cambio.' }
  }

  return { ok: true, payload }
}

/** A human-readable diff string — what `propose_task_update` returns
 *  alongside the proposal id, so the agent (and the partner reading its
 *  output) can see exactly what would be applied before confirming. */
export function describeTaskUpdateProposal(p: TaskUpdateProposal): string {
  const parts: string[] = [p.taskId === undefined ? 'Crear una nueva acción' : `Actualizar la acción ${p.taskId}`]
  if (p.title !== undefined) parts.push(`título: "${p.title}"`)
  if (p.dueAt !== undefined) parts.push(`fecha límite: ${p.dueAt ?? 'sin fecha'}`)
  if (p.outcome !== undefined) parts.push(`resultado: ${p.outcome}`)
  if (p.completedAt !== undefined) parts.push('marcar como completada')
  if (p.interactionNote !== undefined) parts.push('agregar una nota de interacción')
  return parts.join(' — ')
}
