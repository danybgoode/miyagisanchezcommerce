/**
 * lib/portfolio/sla.ts
 *
 * Merchant Partner lifecycle · Sprint 1, Story 1.1 — the response-window SLA
 * contract (README D3). This is the ONLY genuinely NEW contract the epic adds:
 * per-stage "how long may this merchant sit without a dated next action or an
 * interaction", the escalation target, and `SLA_POLICY_VERSION`. Versioned like
 * `lib/scorecard/dictionary.ts`'s metric dictionary and admin-writable through
 * `merchant_sla_policy` (`lib/portfolio/policy-server.ts`), with the code
 * default below as the authoritative fallback whenever the stored row is absent
 * or unreadable.
 *
 * D3 — EVERYTHING ELSE IS IMPORTED, NEVER RESTATED. `isOverdue`,
 * `isMissingAction`, `nextOpenTask` and `ageInStageDays` come from
 * `lib/relationship-pipeline.ts` BY IMPORT; `STAGES` / `STAGE_ORDINAL` come
 * from `lib/merchant-stage.ts` BY REFERENCE; the timezone every day boundary is
 * computed against comes from `lib/scorecard/dictionary.ts` BY REFERENCE. This
 * file defines no stage list, no overdue rule, no aging rule and no threshold
 * that already exists elsewhere — and `e2e/portfolio-sla.spec.ts` enforces that
 * with the same reference-equality + source-text guard
 * `e2e/scorecard-dictionary.spec.ts` already uses (LEARNINGS: "a paraphrased
 * contract drifts permissive — cite the source, don't restate it").
 *
 * ZERO-IMPORT (build contract): no `server-only`, no `next/*`, no Clerk, no
 * Supabase. Every module it imports (`lib/merchant-stage.ts`,
 * `lib/relationship-pipeline.ts`, `lib/scorecard/dictionary.ts`) is itself
 * zero-import, so an `api` Playwright spec loads this file — and walks every
 * branch below — with no database. The impure half (reading/writing the stored
 * policy) lives in the `policy-server.ts` sibling.
 *
 * DELIBERATE NON-IMPORT, stated: the retention window (`RETENTION_WINDOW_DAYS`,
 * `lib/merchant-medusa-reads.ts`) is NOT imported or restated here. That module
 * is `server-only`-tainted, so importing it would break the "an `api` spec can
 * load this file" half of the story's own acceptance — the exact problem
 * `lib/scorecard/dictionary.ts`'s header documents and solves the same way
 * (the impure caller passes the real constant in). Sprint 3's retention work
 * takes it as a parameter; nothing in this file needs it, and no window below
 * is that number.
 */
import { STAGES, STAGE_ORDINAL, isStage, type Stage } from '@/lib/merchant-stage'
import {
  nextOpenTask,
  isMissingAction,
  isOverdue,
  ageInStageDays,
  type OpenTaskFact,
} from '@/lib/relationship-pipeline'
import { SCORECARD_TIMEZONE } from '@/lib/scorecard/dictionary'

/** Bump on ANY change to a window, to the escalation rule, or to
 *  `resolveSlaState`'s output shape — every portfolio row echoes this so a
 *  rendered queue can always name the policy it was computed under, and a
 *  stored `merchant_sla_policy` row can be told apart from the code default.
 *  Same discipline as `SCORECARD_SCHEMA_VERSION`. */
export const SLA_POLICY_VERSION = 1

/** Re-exported BY REFERENCE from the scorecard dictionary, never redefined —
 *  every "day" boundary in this epic is the same Mexico-City day the scorecard
 *  and `lib/relationship-pipeline.ts#dueAtIsoFromDateOnly` already use.
 *  `e2e/portfolio-sla.spec.ts` asserts reference equality, which only holds for
 *  a genuine re-export. */
export const SLA_TIMEZONE = SCORECARD_TIMEZONE

/** Re-exported BY REFERENCE (D3) so nothing in `lib/portfolio/` ever carries a
 *  parallel stage list or ordinal map. Asserted reference-equal in the spec. */
export const SLA_STAGES: readonly Stage[] = STAGES
export const SLA_STAGE_ORDINAL: Readonly<Record<Stage, number>> = STAGE_ORDINAL

/**
 * The per-stage response-window policy — the NEW contract.
 *
 *  - `responseDays`: how long a merchant in this stage may sit with NO dated
 *    next action, measured from its last TOUCH (the latest of "entered this
 *    stage" and "last recorded interaction"). Exceeding it is
 *    `'no_dated_action'`.
 *  - `stallDays`: how long a merchant may remain in this stage AT ALL, however
 *    diligently it is being worked. Exceeding it is `'stage_stalled'` — the
 *    case a dated-but-endlessly-rescheduled task would otherwise hide.
 *
 * Both are whole days. Neither is a restatement of anything: no other module in
 * this repo expresses "how long may a merchant sit in a stage".
 */
export interface SlaStageWindow {
  responseDays: number
  stallDays: number
}

export interface SlaPolicy {
  version: number
  /** One window per stage. Typed `Record<Stage, …>`, so adding a 14th stage to
   *  `STAGES` fails `tsc` here rather than silently leaving that stage with no
   *  window (guard the population, not the door). */
  stages: Readonly<Record<Stage, SlaStageWindow>>
  /** Who to escalate to when a relationship has no per-row
   *  `escalation_clerk_user_id`. `null` ⇒ nobody configured; the queue renders
   *  "sin destinatario de escalación" rather than inventing one. */
  escalationClerkUserId: string | null
}

/**
 * The AUTHORITATIVE fallback (README D3): used whenever `merchant_sla_policy`
 * has no row, or its row is unreadable, or its JSON fails `parseSlaPolicy`.
 *
 * The shape of the curve is deliberate and is the policy's actual content:
 * pre-consent stages are worked in days (a scouted merchant who sits for a week
 * is a lost merchant), the hand-off stages around activation get more room
 * because they wait on the merchant, and the post-sale stages are the widest
 * because their progress is driven by commerce facts Miyagi does not control.
 * `stallDays` is always ≥ `responseDays` — a stage can never be "stalled"
 * sooner than it can be "unattended". Asserted in `e2e/portfolio-sla.spec.ts`
 * for every stage, mechanically over `STAGES`.
 */
export const DEFAULT_SLA_POLICY: SlaPolicy = {
  version: SLA_POLICY_VERSION,
  stages: {
    scouted: { responseDays: 3, stallDays: 14 },
    qualified: { responseDays: 2, stallDays: 10 },
    permission_granted: { responseDays: 2, stallDays: 7 },
    preview_in_preparation: { responseDays: 2, stallDays: 7 },
    preview_delivered: { responseDays: 2, stallDays: 10 },
    activation_scheduled: { responseDays: 3, stallDays: 14 },
    claimed: { responseDays: 4, stallDays: 21 },
    payments_ready: { responseDays: 4, stallDays: 21 },
    three_products_live: { responseDays: 5, stallDays: 28 },
    shared_externally: { responseDays: 5, stallDays: 28 },
    first_inquiry: { responseDays: 2, stallDays: 14 },
    first_sale: { responseDays: 7, stallDays: 45 },
    retained_30d: { responseDays: 14, stallDays: 90 },
  },
  escalationClerkUserId: null,
}

/** The window for `stage`, falling back to the base stage's window for a stage
 *  string the DB CHECK would already have rejected (defensive — a row whose
 *  stage is unrecognized still gets a real deadline instead of `Infinity`). */
export function windowForStage(policy: SlaPolicy, stage: string): SlaStageWindow {
  return isStage(stage) ? policy.stages[stage] : policy.stages[STAGES[0]]
}

/**
 * WHY a relationship is overdue — a discriminated reason, never a bare boolean,
 * because the work queue renders the explanation next to the row (build
 * contract: "the overdue reason must be explainable").
 *
 *  - `action_past_due`  — a DATED open task exists and its date has passed
 *                         (`lib/relationship-pipeline.ts#isOverdue`).
 *  - `no_dated_action`  — no dated open task at all, and the stage's
 *                         `responseDays` have elapsed since the last touch.
 *  - `stage_stalled`    — the relationship has been in this stage longer than
 *                         `stallDays`, however well it is being worked.
 */
export type SlaOverdueReason = 'action_past_due' | 'no_dated_action' | 'stage_stalled'

/** Already-fetched facts `resolveSlaState` decides over. Deliberately a flat
 *  bag of primitives + the raw open-task list (never a `RelationshipRow`), so
 *  this file needs no type from a `server-only` module and a spec can build one
 *  by hand. */
export interface SlaFacts {
  stage: string
  stageEnteredAt: string
  /** EVERY open task, unfiltered — `resolveSlaState` runs the SHIPPED
   *  `nextOpenTask`/`isMissingAction` predicates over it rather than trusting a
   *  caller's precomputed "next action", so the SLA layer and
   *  `lib/relationship-enrich.ts` can never disagree about what "the next
   *  action" is: they call the same two functions. */
  openTasks: OpenTaskFact[]
  /** ISO instant of the most recent recorded interaction, or `null` when the
   *  relationship has never been touched. `null` is NOT treated as "touched
   *  now" — the clock then runs from `stageEnteredAt`. */
  lastInteractionAt: string | null
  /** The row's own `escalation_clerk_user_id`, or `null` to fall back to the
   *  policy's target. */
  escalationClerkUserId: string | null
}

export interface SlaState {
  /** The deadline this row is judged against: the dated next action's own due
   *  date when there is one, otherwise the response deadline derived from the
   *  last touch + the stage's `responseDays`. Never `null` — every relationship
   *  always has a deadline, which is the whole point of the policy. */
  dueAt: string
  overdue: boolean
  /** `null` if and only if `overdue` is false. */
  overdueReason: SlaOverdueReason | null
  /** Whole days the row has been in its current stage
   *  (`lib/relationship-pipeline.ts#ageInStageDays`, imported). */
  ageInStageDays: number
  /** The row's own escalation target, else the policy's, else `null`. */
  escalationTarget: string | null
  /** The policy version this state was computed under. */
  policyVersion: number
}

const DAY_MS = 86_400_000

/** The last time anything happened to this relationship: the later of "entered
 *  the current stage" and "last recorded interaction". Unparseable timestamps
 *  degrade to the other side rather than producing `NaN`. */
function lastTouchMs(facts: SlaFacts): number {
  const enteredMs = Date.parse(facts.stageEnteredAt)
  const interactionMs = facts.lastInteractionAt === null ? NaN : Date.parse(facts.lastInteractionAt)
  const candidates = [enteredMs, interactionMs].filter((ms) => Number.isFinite(ms))
  if (candidates.length === 0) return NaN
  return Math.max(...candidates)
}

/**
 * The pure SLA decision. Precedence among the three reasons is deliberate and
 * ordered by how ACTIONABLE the explanation is to the human reading the queue:
 *
 *   1. `action_past_due` — the most specific: a concrete commitment was missed,
 *      and there is a named task to open. Decided by the SHIPPED `isOverdue`
 *      over the SHIPPED `nextOpenTask`, so it agrees with `/promotor/relaciones`
 *      and the scorecard's `overdue_count` by construction.
 *   2. `no_dated_action` — nothing is scheduled and the response window has
 *      run out. The fix is "schedule something", not "chase a date".
 *   3. `stage_stalled` — everything looks tended (a dated, not-yet-due task
 *      exists) but the merchant has not actually moved in far too long. Ranked
 *      last precisely because it is the least specific; ranked at all because
 *      without it an endlessly-rescheduled task renders forever green.
 *
 * Never throws: garbage timestamps, an empty task list and an unrecognized
 * stage all resolve to a real, explainable state (see `windowForStage` and
 * `lastTouchMs`).
 */
export function resolveSlaState(facts: SlaFacts, policy: SlaPolicy, now: Date): SlaState {
  const window = windowForStage(policy, facts.stage)
  const next = nextOpenTask(facts.openTasks)
  const missing = isMissingAction(facts.openTasks)
  const age = ageInStageDays(facts.stageEnteredAt, now)
  const escalationTarget = facts.escalationClerkUserId ?? policy.escalationClerkUserId ?? null

  const touchMs = lastTouchMs(facts)
  const responseDeadlineMs = Number.isFinite(touchMs)
    ? touchMs + window.responseDays * DAY_MS
    : now.getTime()
  // The deadline the row is JUDGED against: a real dated commitment outranks
  // the derived response window — a promoter who scheduled a call for Friday is
  // held to Friday, not to "3 days after we last spoke".
  const dueAt = next?.dueAt ?? new Date(responseDeadlineMs).toISOString()

  // 1. A missed dated commitment — the SHIPPED predicate, never a re-derived
  //    date comparison.
  if (isOverdue(next, now)) {
    return {
      dueAt,
      overdue: true,
      overdueReason: 'action_past_due',
      ageInStageDays: age,
      escalationTarget,
      policyVersion: policy.version,
    }
  }

  // 2. Nothing dated is scheduled and the response window has elapsed. Uses the
  //    SHIPPED `isMissingAction` (an UNDATED open task does NOT count as
  //    scheduled — C2 of activation-ops, honored here by import rather than
  //    re-decided).
  if (missing && now.getTime() > responseDeadlineMs) {
    return {
      dueAt,
      overdue: true,
      overdueReason: 'no_dated_action',
      ageInStageDays: age,
      escalationTarget,
      policyVersion: policy.version,
    }
  }

  // 3. Tended but not moving.
  if (age > window.stallDays) {
    return {
      dueAt,
      overdue: true,
      overdueReason: 'stage_stalled',
      ageInStageDays: age,
      escalationTarget,
      policyVersion: policy.version,
    }
  }

  return {
    dueAt,
    overdue: false,
    overdueReason: null,
    ageInStageDays: age,
    escalationTarget,
    policyVersion: policy.version,
  }
}

// ── Stored-policy parsing (fail closed to the code default) ──────────────────

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function parseWindow(raw: unknown): SlaStageWindow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { responseDays, stallDays } = raw as { responseDays?: unknown; stallDays?: unknown }
  if (!isPositiveInt(responseDays) || !isPositiveInt(stallDays)) return null
  // A stage that can be "stalled" sooner than it can be "unattended" is an
  // incoherent policy — reject the whole document rather than silently ranking
  // the two reasons in an order the queue's copy doesn't describe.
  if (stallDays < responseDays) return null
  return { responseDays, stallDays }
}

/**
 * Validate an untrusted `merchant_sla_policy.policy` document. Returns
 * `DEFAULT_SLA_POLICY` on ANY malformed shape — a missing stage, a non-integer
 * window, a negative day count, a stall shorter than its response window, a
 * non-object, `null`, an array. FAIL CLOSED AND WHOLE: never a merge of the
 * stored document over the default, because a half-applied policy is a policy
 * nobody wrote and nobody can reason about (build contract: "fail-closed to the
 * code default on any malformed shape... never a silent half-policy").
 *
 * Every member of `STAGES` must be present — the population is re-derived from
 * the canonical array, so a 14th stage added later makes an old stored document
 * fail closed (correctly: it genuinely has no window for that stage) without
 * anyone editing this function.
 */
export function parseSlaPolicy(raw: unknown): SlaPolicy {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_SLA_POLICY
  const doc = raw as { version?: unknown; stages?: unknown; escalationClerkUserId?: unknown }

  if (!isPositiveInt(doc.version)) return DEFAULT_SLA_POLICY

  if (typeof doc.stages !== 'object' || doc.stages === null || Array.isArray(doc.stages)) {
    return DEFAULT_SLA_POLICY
  }
  const rawStages = doc.stages as Record<string, unknown>

  const stages = {} as Record<Stage, SlaStageWindow>
  for (const stage of STAGES) {
    const parsed = parseWindow(rawStages[stage])
    if (!parsed) return DEFAULT_SLA_POLICY
    stages[stage] = parsed
  }

  const escalation = doc.escalationClerkUserId
  if (escalation !== null && escalation !== undefined && typeof escalation !== 'string') {
    return DEFAULT_SLA_POLICY
  }

  return {
    version: doc.version,
    stages,
    escalationClerkUserId: typeof escalation === 'string' && escalation.length > 0 ? escalation : null,
  }
}

/** Serialize a policy for storage — the exact inverse of `parseSlaPolicy`, so a
 *  written document always round-trips. Only ever emits the keys the parser
 *  accepts (a positive-list builder, never a delete-from-a-wider-object). */
export function serializeSlaPolicy(policy: SlaPolicy): Record<string, unknown> {
  const stages: Record<string, SlaStageWindow> = {}
  for (const stage of STAGES) {
    stages[stage] = {
      responseDays: policy.stages[stage].responseDays,
      stallDays: policy.stages[stage].stallDays,
    }
  }
  return { version: policy.version, stages, escalationClerkUserId: policy.escalationClerkUserId }
}

export type { OpenTaskFact, Stage }
