/**
 * lib/portfolio/reassign.ts
 *
 * Merchant Partner lifecycle · Sprint 1, Story 1.3 — the PURE half of
 * stewardship reassignment: the body parser and, more importantly, the UPDATE
 * PAYLOAD BUILDER.
 *
 * WHY THE PAYLOAD IS A FUNCTION AND NOT AN INLINE OBJECT IN THE WRITER: the
 * story's real acceptance is an INVARIANT — "promoter/cohort/referral/commission
 * records are unchanged". An invariant asserted in a comment is not evidence
 * (LEARNINGS: "a confident comment is not evidence"). Extracting the payload
 * makes it a value a spec can inspect with no database, so
 * `e2e/portfolio-reassign.spec.ts` can prove — for every input shape, including
 * ones nobody thought of — that the update touches ONLY the four stewardship
 * columns and never an attribution column. The forbidden set in that spec is
 * DERIVED from `AUDITED_FIELDS` (`lib/relationship-access.ts`) rather than typed
 * out, so an audited field added later is covered without editing the spec.
 *
 * PARTIAL BY DESIGN. Only the fields the caller EXPLICITLY passes appear in the
 * payload; `undefined` means "do not touch this column", which is what lets the
 * shipped promoter-facing owner route
 * (`POST /api/promoter/relationship/[id]/owner`, activation-ops S2.2) share the
 * writer while keeping its behavior byte-identical — it passes only the steward,
 * so it writes only the steward, exactly as it does in production today. A
 * builder that always emitted all four columns would have that route silently
 * NULL out `assignment_reason` / `assigned_at` on every promoter reassignment.
 *
 * Zero-import beyond `lib/relationship-pipeline.ts` (zero-import itself), so an
 * `api` spec loads this file with no database.
 */
import { dueAtIsoFromDateOnly, isDateOnlyShape } from '@/lib/relationship-pipeline'

/**
 * The ONLY columns on `merchant_relationships` a reassignment may write (plus
 * `updated_at`, the universal row-touch timestamp every write in this repo
 * bumps). Exported as data so the writer and the invariant spec read the same
 * list — neither can drift from the other.
 */
export const STEWARDSHIP_UPDATE_FIELDS = [
  'steward_clerk_user_id',
  'assignment_reason',
  // The OPTIONAL partner-visible handoff note. Distinct from `assignment_reason`,
  // which is audit-only and never rendered to a partner — Daniel's call on
  // fresh-reviewer finding 3 (PR 308). See the migration for the full reasoning.
  'assignment_handoff_note',
  'assigned_at',
  'escalation_clerk_user_id',
] as const

export type StewardshipUpdateField = (typeof STEWARDSHIP_UPDATE_FIELDS)[number]

/** `updated_at` is not a stewardship field and not an attribution field — it is
 *  the row-touch timestamp. Named separately so the spec's allowed set is
 *  explicit about it rather than quietly tolerating an extra key. */
export const ROW_TOUCH_FIELD = 'updated_at' as const

/**
 * A Clerk user id's own shape (`user_<base62ish>`) is narrower than this, but
 * this repo does not parse Clerk ids anywhere, so a generous safe-charset +
 * length cap is what stops garbage from becoming a load-bearing ACCESS value
 * (`steward_clerk_user_id` grants `manager` access via
 * `decideRelationshipRole`). MOVED here from the shipped owner route, which now
 * imports it: one regex, two routes, no chance of the admin path being laxer
 * than the promoter path.
 */
export const STEWARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface StewardshipUpdateInput {
  /** `null` explicitly CLEARS the steward ("nobody owns this right now").
   *  `undefined` leaves the column alone. */
  toSteward?: string | null
  assignmentReason?: string | null
  /** Partner-visible. `undefined` leaves the column alone; `null` clears it. */
  assignmentHandoffNote?: string | null
  assignedAt?: string | null
  escalationClerkUserId?: string | null
  /** ISO instant for the row-touch timestamp. Always written. */
  now: string
}

/**
 * Build the Supabase update payload. A POSITIVE-LIST CONSTRUCTOR: it names each
 * allowed column, and there is no code path by which any other key can enter the
 * object — it never spreads an input, and it never deletes from a wider object.
 */
export function buildStewardshipUpdate(input: StewardshipUpdateInput): Record<string, string | null> {
  const update: Record<string, string | null> = { [ROW_TOUCH_FIELD]: input.now }
  if (input.toSteward !== undefined) update.steward_clerk_user_id = input.toSteward
  if (input.assignmentReason !== undefined) update.assignment_reason = input.assignmentReason
  if (input.assignmentHandoffNote !== undefined) update.assignment_handoff_note = input.assignmentHandoffNote
  if (input.assignedAt !== undefined) update.assigned_at = input.assignedAt
  if (input.escalationClerkUserId !== undefined) update.escalation_clerk_user_id = input.escalationClerkUserId
  return update
}

// ── The ADMIN reassignment body ──────────────────────────────────────────────

export interface ParsedReassign {
  /** `null` clears the steward. */
  toSteward: string | null
  /** REQUIRED and non-blank — a privileged ownership change with no stated
   *  reason is exactly the audit gap this story exists to close. */
  reason: string
  /** OPTIONAL, and the ONLY one of the two the partner portfolio renders. Empty
   *  or absent ⇒ `null`, and the row shows no assignment line at all — the
   *  private `reason` is NEVER substituted in as a fallback (that substitution
   *  would defeat the whole point of splitting them). */
  handoffNote: string | null
  /** Resolved to a full ISO instant. Defaults to `now`. */
  effectiveAt: string
  /** REQUIRED. Silence is NOT an option: an open task left pointing at the old
   *  steward while the record moves is an orphan the queue would show to nobody,
   *  so the request must state which behavior it wants rather than inheriting a
   *  default nobody chose. */
  transferOpenTasks: boolean
  /** `undefined` leaves the escalation column alone; `null` clears it. */
  escalationClerkUserId?: string | null
}

export type ReassignParse =
  | { ok: true; value: ParsedReassign }
  | { ok: false; status: 400 | 422; error: string }

/**
 * Parse + validate the admin reassignment body. 400 for a WRONG TYPE (a caller
 * bug), 422 for a MISSING REQUIRED DECISION (a caller omission) — the same
 * distinction the shipped `correct-stage` route draws between "reason is not a
 * string" and "reason is absent", and the same reason it draws it: the two need
 * different fixes.
 *
 * `effectiveAt` accepts a full ISO datetime OR the `YYYY-MM-DD` shape an
 * `<input type="date">` sends. The date-only case goes through the SHIPPED
 * `dueAtIsoFromDateOnly` (imported, never re-derived), which interprets it as
 * the END of that Mexico-City calendar day and rejects a calendar-invalid date
 * like `2026-02-31` — the exact C8/D3e behavior activation-ops paid two review
 * rounds to get right.
 */
export function parseReassignBody(body: unknown, now: Date): ReassignParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Cuerpo inválido.' }
  }
  const raw = body as {
    toSteward?: unknown
    reason?: unknown
    handoffNote?: unknown
    effectiveAt?: unknown
    transferOpenTasks?: unknown
    escalationClerkUserId?: unknown
  }

  // ── toSteward ──
  if (raw.toSteward !== undefined && raw.toSteward !== null && typeof raw.toSteward !== 'string') {
    return { ok: false, status: 400, error: 'Dueño inválido.' }
  }
  const toSteward = (typeof raw.toSteward === 'string' ? raw.toSteward : '').trim() || null
  if (toSteward !== null && !STEWARD_ID_RE.test(toSteward)) {
    return { ok: false, status: 400, error: 'Dueño inválido.' }
  }

  // ── reason (required) ──
  if (raw.reason !== undefined && typeof raw.reason !== 'string') {
    return { ok: false, status: 400, error: 'Razón inválida.' }
  }
  const reason = (raw.reason ?? '').trim()
  if (!reason) {
    return { ok: false, status: 422, error: 'La reasignación requiere una razón.' }
  }

  // OPTIONAL — unlike `reason`. An admin who wants to tell the incoming partner
  // something says so deliberately; the candid audit reason is never leaked as a
  // stand-in (finding 3, PR 308).
  if (raw.handoffNote !== undefined && raw.handoffNote !== null && typeof raw.handoffNote !== 'string') {
    return { ok: false, status: 400, error: 'Nota de traspaso inválida.' }
  }
  const handoffNote = (typeof raw.handoffNote === 'string' ? raw.handoffNote.trim() : '') || null

  // ── transferOpenTasks (required, no default) ──
  if (typeof raw.transferOpenTasks !== 'boolean') {
    return {
      ok: false,
      status: 422,
      error:
        'Indica explícitamente si las tareas abiertas se transfieren al nuevo responsable (transferOpenTasks: true | false).',
    }
  }
  const transferOpenTasks = raw.transferOpenTasks

  // ── effectiveAt (optional) ──
  let effectiveAt = now.toISOString()
  if (raw.effectiveAt !== undefined && raw.effectiveAt !== null) {
    if (typeof raw.effectiveAt !== 'string') {
      return { ok: false, status: 400, error: 'Fecha efectiva inválida.' }
    }
    const trimmed = raw.effectiveAt.trim()
    if (trimmed.length === 0) {
      return { ok: false, status: 400, error: 'Fecha efectiva inválida.' }
    }
    if (isDateOnlyShape(trimmed)) {
      const iso = dueAtIsoFromDateOnly(trimmed)
      if (iso === null) return { ok: false, status: 400, error: 'Fecha efectiva inválida.' }
      effectiveAt = iso
    } else {
      const ms = Date.parse(trimmed)
      if (!Number.isFinite(ms)) return { ok: false, status: 400, error: 'Fecha efectiva inválida.' }
      effectiveAt = new Date(ms).toISOString()
    }
  }

  // ── escalationClerkUserId (optional; null clears) ──
  let escalationClerkUserId: string | null | undefined
  if (raw.escalationClerkUserId !== undefined) {
    if (raw.escalationClerkUserId === null) {
      escalationClerkUserId = null
    } else if (typeof raw.escalationClerkUserId !== 'string') {
      return { ok: false, status: 400, error: 'Destinatario de escalación inválido.' }
    } else {
      const trimmed = raw.escalationClerkUserId.trim()
      if (trimmed.length === 0) escalationClerkUserId = null
      else if (!STEWARD_ID_RE.test(trimmed)) {
        return { ok: false, status: 400, error: 'Destinatario de escalación inválido.' }
      } else escalationClerkUserId = trimmed
    }
  }

  return { ok: true, value: { toSteward, reason, handoffNote, effectiveAt, transferOpenTasks, escalationClerkUserId } }
}
