/**
 * lib/portfolio/reminders.ts
 *
 * Merchant Partner lifecycle · Sprint 2, Story 2.2 — the PURE half of the
 * steward reminder rail: which windows are due, and what copy a reminder
 * carries. ZERO-IMPORT beyond the zero-import `resolver.ts`/`sla.ts` siblings
 * (types only) — no `server-only`, no `next/*`, no Clerk, no Supabase — so an
 * `api` spec loads this with no database. The impure half (claim-then-deliver
 * under the UNIQUE constraint, the actual `notify`/`tgSend` calls) lives in
 * the `reminders-server.ts` sibling.
 *
 * IDEMPOTENCY IS A PROPERTY OF THE KEY, NOT OF A QUERY (README D6). This file
 * only computes `windowKey` — a stable string per logical window — and the
 * caller's UNIQUE `(relationship_id, kind, window_key)` constraint is what
 * actually enforces "once per window", never a SELECT-then-INSERT here.
 *
 * `reminderWindowKey` takes the due/window value, NEVER `now` — the window is
 * a property of the COMMITMENT the row is judged against (its SLA `dueAt`),
 * not of when a cron happened to run. A relationship that stays overdue
 * against the SAME due date is reminded exactly ONCE for that date; the
 * window renews only when the underlying commitment itself changes (a new
 * dated task, a policy-driven re-derivation of `dueAt`) — never merely
 * because a day passed.
 *
 * THIS TYPE HAS NO DRAFT-SHAPED FIELD, AND NEVER WILL (Story 2.3's second
 * spec: the reminder path can never carry draft text). `ReminderTarget`/
 * `ReminderCopy` below are built from the SLA/portfolio facts alone — nothing
 * in this file imports `draft-facts.ts`, `draft-compose.ts` or reads
 * `merchant_followup_drafts`.
 */
import type { PortfolioRow } from '@/lib/portfolio/resolver'
import type { SlaPolicy } from '@/lib/portfolio/sla'

export type ReminderKind = 'sla_overdue'

export const REMINDER_KINDS: readonly ReminderKind[] = ['sla_overdue']

/**
 * A stable string per logical window. The SAME `dueAtOrWindowStart` always
 * produces the SAME key — that's the whole idempotency guarantee this
 * function exists to provide (README D6): the caller writes
 * `(relationshipId, kind, windowKey)` under a UNIQUE constraint, and a
 * same-window re-run collides on `23505`, which `reminders-server.ts` treats
 * as "already reminded" and skips silently.
 */
export function reminderWindowKey(kind: ReminderKind, dueAtOrWindowStart: string): string {
  return `${kind}:${dueAtOrWindowStart}`
}

/** Everything a reminder needs to pick a recipient and build its copy. NO
 *  draft field exists on this type — see the file header. */
export interface ReminderTarget {
  relationshipId: string
  kind: ReminderKind
  windowKey: string
  /** The row's assigned steward, if any — the PRIMARY recipient (README D6:
   *  "steward-directed only"). */
  stewardClerkUserId: string | null
  /** Where to route when there is no steward — the row's own escalation
   *  target, else the policy's. `null` ⇒ admin-channel-only. */
  escalationTarget: string | null
  overdueReason: PortfolioRow['slaOverdueReason']
  businessName: string
  dueAt: string
}

/**
 * Which rows are due for a reminder RIGHT NOW. Overdue rows only, in v1 — a
 * row that is merely `due_soon`/`missing`/`scheduled` has not yet broken a
 * commitment, so nothing to remind a steward ABOUT exists yet.
 *
 * `now` is accepted for signature symmetry with `resolveSlaState` and so a
 * future cadence rule (e.g. "also re-remind after N days") has somewhere to
 * read the clock from — v1 does not use it, because `windowKey` deliberately
 * never depends on wall-clock time (see the file header). `policy` is
 * likewise accepted so a future per-stage reminder-eligibility rule can read
 * it without changing this function's signature again; v1 reminds every
 * overdue row identically regardless of which stage window it broke.
 */
export function selectReminderTargets(rows: readonly PortfolioRow[], now: Date, policy: SlaPolicy): ReminderTarget[] {
  void now
  void policy
  const targets: ReminderTarget[] = []
  for (const row of rows) {
    if (!row.slaOverdue) continue
    targets.push({
      relationshipId: row.id,
      kind: 'sla_overdue',
      windowKey: reminderWindowKey('sla_overdue', row.slaDueAt),
      stewardClerkUserId: row.stewardClerkUserId,
      escalationTarget: row.escalationTarget,
      overdueReason: row.slaOverdueReason,
      businessName: row.businessName,
      dueAt: row.slaDueAt,
    })
  }
  return targets
}

const OVERDUE_REASON_LABEL: Readonly<Record<string, string>> = {
  action_past_due: 'una acción vencida',
  no_dated_action: 'sin próxima acción agendada dentro del plazo de respuesta',
  stage_stalled: 'demasiado tiempo sin avanzar de etapa',
}

export interface ReminderCopy {
  title: string
  body: string
  telegramHtml: string
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The reminder's COPY, built from `ReminderTarget` alone (Story 2.3's second
 * spec) — never from a draft, never from raw contact fields. `deepLinkPath`
 * is the AUTHORIZED portfolio record the reminder returns to (build
 * contract: "the reminder deep-link lands on an authorized portfolio record
 * ... never embeds contact data or a bypass token") — just the relationship
 * id in a plain internal path; the target page re-runs its own scope check.
 */
export function buildReminderCopy(target: ReminderTarget): ReminderCopy {
  const reasonLabel = target.overdueReason
    ? (OVERDUE_REASON_LABEL[target.overdueReason] ?? target.overdueReason)
    : 'seguimiento pendiente'
  const title = `Seguimiento vencido: ${target.businessName}`
  const body = `${target.businessName}: ${reasonLabel}. Revisa tu cartera para continuar.`
  const telegramHtml = `⏰ <b>Seguimiento vencido</b>\n${escHtml(target.businessName)} — ${escHtml(reasonLabel)}`
  return { title, body, telegramHtml }
}

/** The internal deep link a reminder carries — relationship id only, no
 *  contact data, no bypass token. The `/partner` page re-runs
 *  `resolveRelationshipAccess`/the scoped list on load, same as any direct
 *  visit. */
export function reminderDeepLinkPath(relationshipId: string): string {
  return `/partner?relationshipId=${encodeURIComponent(relationshipId)}`
}

// ── The latest-reminder fold (extracted for testability, PR #310 review) ──────

/** One `merchant_followup_reminders` row, reduced to what the fold below needs. */
export interface ReminderStatusRow {
  relationshipId: string
  lastError: string | null
}

/**
 * Given reminder rows ordered NEWEST-FIRST, return the relationships whose most
 * recent reminder FAILED, mapped to that failure's message.
 *
 * Extracted out of `lib/portfolio/reminders-server.ts` (which is `server-only`,
 * so no `api` spec could ever load it) after the cross-agent review on PR #310
 * found a real false-positive bug in the inlined version: it used the RESULT map
 * as its "already handled" test, but that map is only written for a FAILED row —
 * so a relationship whose newest reminder SUCCEEDED never got recorded, and the
 * next older FAILED row was accepted instead. The portfolio then showed
 * "Recordatorio no entregado" for a merchant whose latest reminder went out
 * cleanly, sending a partner to chase a delivery that already happened.
 *
 * The defect was invisible because the code's own comment described the intended
 * rule ("newest-first + first-write-wins") rather than what the code did — the
 * two only coincide when EVERY row failed. This is the epic's usual split
 * applied after the fact: the pure decision lives here where a spec can walk
 * every branch, and the server module keeps only the query.
 *
 * FIRST-SEEN WINS, tracked independently of the result: a successful newest row
 * closes the relationship out and contributes no entry.
 */
export function foldLatestReminderFailures(rowsNewestFirst: readonly ReminderStatusRow[]): Map<string, string> {
  const failures = new Map<string, string>()
  const seen = new Set<string>()
  for (const row of rowsNewestFirst) {
    if (seen.has(row.relationshipId)) continue
    seen.add(row.relationshipId)
    if (row.lastError) failures.set(row.relationshipId, row.lastError)
  }
  return failures
}
