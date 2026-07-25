/**
 * POST /api/promoter/relationship/[id]/task/[taskId]/complete — complete a
 * next action (founding-merchant-activation-ops S2.2). Writes `completed_at`
 * (+ `completed_by`); NEVER deletes the row (build contract: "completing a
 * task writes completed_at and never deletes").
 *
 * The task must belong to THIS `id` — the update predicate includes
 * `relationship_id = id`, so a `taskId` that exists but belongs to a
 * DIFFERENT relationship the caller can't see never completes (it just
 * matches zero rows), never leaking whether that other task exists.
 *
 * Idempotent: completing an already-completed task is a no-op success (the
 * `WHERE completed_at IS NULL` predicate matches nothing, so the ORIGINAL
 * `completed_at`/`completed_by` are preserved) rather than an error — a
 * double-tap on a slow connection must never look like a failure or silently
 * overwrite who actually completed it first.
 *
 * Scope-checked through the ONE shared helper (`resolveRelationshipAccess`);
 * a `viewer` partner-grant may READ but not WRITE (`canWriteRelationship`).
 * Gated by `promoter.activation_crm_enabled` FIRST (404 when OFF, via
 * `authorizeRelationshipRequest`).
 *
 * C11 fix (PR 304 review): a malformed `taskId` (not a valid UUID) makes
 * Postgres raise `22P02`, which used to fall through to the generic 500
 * branch below. Not exploitable (the `relationship_id` predicate already
 * scopes the update to nothing), but the wrong status + needless log noise
 * — `22P02` now maps to the same 404 a genuinely-missing task gets, mirroring
 * `resolveRelationshipAccess`'s own "a malformed-UUID read is indistinguishable
 * from not-found" convention.
 *
 * EXTENDED — Merchant Partner lifecycle · Sprint 3, Story 3.1 (README D7).
 * Two ADDITIVE, fully-optional body fields, backward compatible with every
 * existing caller that sends neither:
 *
 *   - `outcome` — one of `lib/scorecard/dictionary.ts#RETENTION_OUTCOMES`
 *     (imported, never restated), recorded on the SAME task row. Never
 *     restricted to `kind = 'retention_30d'` at this layer — the DB CHECK
 *     already bounds the vocabulary regardless of which task carries it.
 *   - `nextAction` — an optional `{ title, dueAt? }` that, when the
 *     completion actually took effect, creates one new open `kind: 'manual'`
 *     task assigned to the completing caller (the same shape
 *     `POST .../task` itself accepts, including the date-only C8/D3e
 *     handling), so a partner can close one loop and open the next in one
 *     call.
 *
 * `outcome`/`nextAction` are only applied/created on a completion this
 * request ITSELF performed (`justCompleted`, detected via `.select()` on
 * the UPDATE) — never on the idempotent "already completed" replay branch,
 * which must stay a pure no-op.
 *
 * Story 3.3 (README D8/D9) — two PII-free portfolio events, best-effort,
 * emitted AFTER the canonical write, never instead of it:
 *   - `merchant.retention_outcome_recorded` when an `outcome` was recorded.
 *   - `merchant.sla_completed` when the task being completed had a `due_at`
 *     already in the past (a real commitment was closed out late).
 * Both key off the task's own id — one outcome-recording / one
 * SLA-completion event per task, ever.
 *
 * NEVER TOUCHES MEDUSA. This route only reads/writes
 * `merchant_relationship_tasks` — no sale, order, payment or product.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { authorizeRelationshipRequest, resolveRelationshipAccess, canWriteRelationship } from '@/lib/relationship-access'
import { dueAtIsoFromDateOnly, isDateOnlyShape } from '@/lib/relationship-pipeline'
import { isAllowedOutcome } from '@/lib/portfolio/retention'
import { emitPortfolioLifecycleEvent } from '@/lib/portfolio/events-server'

export const dynamic = 'force-dynamic'

interface CompleteBody {
  outcome?: unknown
  nextAction?: { title?: unknown; dueAt?: unknown }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const auth = await authorizeRelationshipRequest(req)
  if (auth.error) return auth.error

  const { id, taskId } = await params
  const access = await resolveRelationshipAccess(id, auth.actor)
  if (!access.ok) return NextResponse.json({ ok: false }, { status: access.status })
  if (!canWriteRelationship(access.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Tu acceso a este registro es de solo lectura (viewer) — completar una acción requiere el rol manager.',
      },
      { status: 403 },
    )
  }

  // The body is entirely OPTIONAL — a missing/invalid JSON body behaves
  // exactly as it always has (empty object, no outcome, no next action).
  let body: CompleteBody = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) body = raw as CompleteBody
  } catch {
    body = {}
  }

  let outcome: string | undefined
  if (body.outcome !== undefined) {
    if (typeof body.outcome !== 'string' || !isAllowedOutcome(body.outcome)) {
      return NextResponse.json({ ok: false, error: 'Resultado no permitido.' }, { status: 400 })
    }
    outcome = body.outcome
  }

  let nextActionTitle: string | undefined
  let nextActionDueAt: string | null = null
  if (body.nextAction !== undefined) {
    if (typeof body.nextAction !== 'object' || body.nextAction === null || Array.isArray(body.nextAction)) {
      return NextResponse.json({ ok: false, error: 'nextAction inválido.' }, { status: 400 })
    }
    const na = body.nextAction
    if (typeof na.title !== 'string' || !na.title.trim()) {
      return NextResponse.json({ ok: false, error: 'nextAction.title es obligatorio.' }, { status: 400 })
    }
    nextActionTitle = na.title.trim()
    if (na.dueAt !== undefined && na.dueAt !== '') {
      if (typeof na.dueAt !== 'string') {
        return NextResponse.json({ ok: false, error: 'nextAction.dueAt inválido.' }, { status: 400 })
      }
      // Same date-only (C8) / calendar-validity (D3e) handling as
      // `POST /api/promoter/relationship/[id]/task` — imported, never
      // re-derived.
      if (isDateOnlyShape(na.dueAt)) {
        const iso = dueAtIsoFromDateOnly(na.dueAt)
        if (!iso) return NextResponse.json({ ok: false, error: 'nextAction.dueAt inválido.' }, { status: 400 })
        nextActionDueAt = iso
      } else {
        const d = new Date(na.dueAt)
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ ok: false, error: 'nextAction.dueAt inválido.' }, { status: 400 })
        }
        nextActionDueAt = d.toISOString()
      }
    }
  }

  const now = new Date()
  const update: Record<string, unknown> = { completed_at: now.toISOString(), completed_by: auth.user.id }
  if (outcome !== undefined) update.outcome = outcome

  // `.select()` on the UPDATE is what lets this call tell "I just completed
  // it" apart from "it was already completed" — the idempotent replay
  // branch (build contract, unchanged) must never re-apply `outcome` or
  // re-create `nextAction`.
  const { data: updatedRows, error: updateError } = await db
    .from('merchant_relationship_tasks')
    .update(update)
    .eq('id', taskId)
    .eq('relationship_id', id)
    .is('completed_at', null)
    .select('id, due_at')

  if (updateError) {
    // 22P02 = invalid input syntax for uuid — a malformed taskId reads as
    // "not found", the same fail-closed shape `resolveRelationshipAccess`
    // already uses, not a server malfunction.
    if (updateError.code === '22P02') {
      return NextResponse.json({ ok: false, error: 'Acción no encontrada.' }, { status: 404 })
    }
    return NextResponse.json({ ok: false, error: 'No se pudo completar la acción.' }, { status: 500 })
  }

  const justCompletedRow = Array.isArray(updatedRows) && updatedRows.length > 0 ? updatedRows[0] : null
  const justCompleted = justCompletedRow !== null
  const wasOverdue =
    justCompleted &&
    typeof justCompletedRow!.due_at === 'string' &&
    Date.parse(justCompletedRow!.due_at as string) < now.getTime()

  // Re-read regardless of whether the update matched a row — this is the
  // idempotent branch (already completed) OR the just-written state, and the
  // caller always gets the CURRENT truth either way.
  const { data, error: readError } = await db
    .from('merchant_relationship_tasks')
    .select('id, relationship_id, title, due_at, assigned_to, outcome, completed_at, completed_by, created_by, created_at')
    .eq('id', taskId)
    .eq('relationship_id', id)
    .maybeSingle()

  if (readError || !data) {
    return NextResponse.json({ ok: false, error: 'Acción no encontrada.' }, { status: 404 })
  }

  let nextActionTask: Record<string, unknown> | undefined
  if (justCompleted && nextActionTitle) {
    const { data: created, error: createError } = await db
      .from('merchant_relationship_tasks')
      .insert({
        relationship_id: id,
        title: nextActionTitle,
        due_at: nextActionDueAt,
        assigned_to: auth.user.id,
        created_by: auth.user.id,
      })
      .select('id, relationship_id, title, due_at, assigned_to, completed_at, completed_by, created_by, created_at')
      .maybeSingle()
    if (createError) {
      console.error('[task-complete] next-action insert failed:', createError.message)
    } else if (created) {
      nextActionTask = created
    }
  }

  // Story 3.3 — PII-free portfolio events, AFTER the canonical write above,
  // never instead of it. Best-effort: `emitPortfolioLifecycleEvent` never
  // throws, and a claim/send failure here never turns a successful task
  // completion into a failed response.
  if (justCompleted) {
    if (outcome !== undefined) {
      await emitPortfolioLifecycleEvent({
        relationshipId: id,
        event: 'merchant.retention_outcome_recorded',
        dedupeKey: taskId,
        occurredAt: now.toISOString(),
        outcome,
      })
    }
    if (wasOverdue) {
      await emitPortfolioLifecycleEvent({
        relationshipId: id,
        event: 'merchant.sla_completed',
        dedupeKey: taskId,
        occurredAt: now.toISOString(),
      })
    }
  }

  return NextResponse.json({ ok: true, task: data, ...(nextActionTask ? { nextAction: nextActionTask } : {}) })
}
