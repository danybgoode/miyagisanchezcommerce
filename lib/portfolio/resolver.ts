/**
 * lib/portfolio/resolver.ts
 *
 * Merchant Partner lifecycle · Sprint 1, Story 1.2 — the PURE half of the
 * partner work queue: the row DTO, the filter parser, the filter predicate, the
 * ordering and the summary counts. Performs NO I/O. The impure half
 * (`lib/portfolio/loader.ts`) gathers every input through the reuse seams
 * (`listScopedRelationships` → `enrichRelationships` → the SLA layer → one
 * batched last-interaction read) and calls the functions here. Same pure/impure
 * split as `lib/scorecard/{resolver,loader}.ts`, copied deliberately.
 *
 * Zero-import beyond `lib/merchant-stage.ts`, `lib/relationship-pipeline.ts`
 * (types only) and `lib/portfolio/sla.ts` — all zero-import themselves — so this
 * file, and any spec that imports it, loads in the Playwright `api` project with
 * no database.
 *
 * THE LIST IS THE WIDEST SURFACE IN THE EPIC, so `PortfolioRow` is a
 * POSITIVE-LIST DTO: `buildPortfolioRow` CONSTRUCTS the allowed fields one by
 * one. It never spreads an input row and deletes what it shouldn't expose,
 * because a field added to the input later would then leak by default. The raw
 * contact VALUES (`phone_e164`, `email_normalized`, `whatsapp_e164`,
 * `instagram_handle`) are never even accepted as input: `PortfolioInputRow`
 * below has no field that could carry one. A partner reaches a contact value
 * through the existing per-record route, which is already scope-checked.
 * `e2e/portfolio-resolver.spec.ts` asserts the absence by feeding a
 * fully-populated row and checking the serialized output for the values.
 *
 * ORDERING IS TOTAL. `Roadmap/LEARNINGS.md` records a real scorecard bug where
 * an unordered read made a median flip 10 → 50; the fix there and the rule here
 * is the same — every comparison chain ends in a tiebreak that can never return
 * 0 for two distinct rows.
 */
import { STAGE_ORDINAL, isStage, type Stage } from '@/lib/merchant-stage'
import { preferredChannelLabel } from '@/lib/preferred-channels'
import type { OpenTaskFact } from '@/lib/relationship-pipeline'
import type { SlaState } from '@/lib/portfolio/sla'

/**
 * How close a dated next action must be to read as `due_soon` rather than
 * `scheduled`. A QUEUE-TRIAGE threshold, not an SLA window: it changes what a
 * row looks like, never whether it is overdue (that is `resolveSlaState`'s
 * decision alone). Defined here because no other module in this repo expresses
 * "soon" — nothing is being restated.
 */
export const PORTFOLIO_DUE_SOON_DAYS = 2

const DAY_MS = 86_400_000

/**
 * es-MX labels for `merchant_relationships.preferred_channel` — RE-EXPORTED by
 * reference from `lib/preferred-channels.ts`, never redefined here.
 *
 * This module originally carried its own copy, which made a FOURTH copy of a
 * vocabulary that already existed in three places and had already drifted
 * (`email: 'Correo'` vs `'Correo electrónico'`) — fresh-reviewer finding 2 on
 * PR #308. The row exposes this LABEL and never the contact value: which channel
 * a merchant prefers is safe operational context ("call, don't email"); the
 * number itself is not.
 */
export { PREFERRED_CHANNEL_LABEL } from '@/lib/preferred-channels'

/** The already-fetched input the loader hands over. Deliberately carries NO
 *  contact value — see the file header. */
export interface PortfolioInputRow {
  id: string
  businessName: string
  contactName: string | null
  estado: string | null
  municipio: string | null
  category: string | null
  stage: string
  stageEnteredAt: string
  createdAt: string
  /** The raw enum value; the DTO exposes its label. */
  preferredChannel: string | null
  stewardClerkUserId: string | null
  assignmentHandoffNote: string | null
  assignedAt: string | null
  /** From `lib/relationship-enrich.ts` (which computes them with the shipped
   *  `lib/relationship-pipeline.ts` predicates — not recomputed here). */
  ageInStageDays: number
  nextAction: OpenTaskFact | null
  missingAction: boolean
  blocker: boolean
  consentState: string
  openTaskCount: number
  lastInteractionAt: string | null
  /** From `lib/portfolio/sla.ts#resolveSlaState`. */
  sla: SlaState
}

export type PortfolioDueState = 'overdue' | 'due_soon' | 'scheduled' | 'missing'

const DUE_STATES: readonly PortfolioDueState[] = ['overdue', 'due_soon', 'scheduled', 'missing']

export interface PortfolioRow {
  id: string
  businessName: string
  contactName: string | null
  estado: string | null
  municipio: string | null
  category: string | null
  stage: string
  stageOrdinal: number
  ageInStageDays: number
  /** The LABEL, never the value (`null` when the merchant has no stated
   *  preference, or when the stored value is not one of the five known ones). */
  preferredChannel: string | null
  nextActionId: string | null
  nextActionDueAt: string | null
  missingAction: boolean
  blocker: boolean
  consentState: string
  openTaskCount: number
  lastInteractionAt: string | null
  stewardClerkUserId: string | null
  assignmentHandoffNote: string | null
  assignedAt: string | null
  dueState: PortfolioDueState
  slaDueAt: string
  slaOverdue: boolean
  slaOverdueReason: SlaState['overdueReason']
  escalationTarget: string | null
  slaPolicyVersion: number
}

/**
 * The queue's four-way triage state. Derived from the SLA decision plus the
 * shipped missing-action fact — never a second overdue rule:
 *
 *   overdue   — `resolveSlaState` said so (for any of its three reasons).
 *   missing   — not overdue, but nothing DATED is scheduled. Still needs a human.
 *   due_soon  — a dated action lands within `PORTFOLIO_DUE_SOON_DAYS`.
 *   scheduled — dated, and comfortably ahead.
 *
 * `overdue` is checked FIRST so an overdue row can never also be reported as
 * merely `missing` — the two would otherwise both be true for a relationship
 * that has nothing scheduled and has blown its response window, and the queue
 * would under-report the urgent case.
 */
export function deriveDueState(row: Pick<PortfolioInputRow, 'sla' | 'missingAction' | 'nextAction'>, now: Date): PortfolioDueState {
  if (row.sla.overdue) return 'overdue'
  if (row.missingAction) return 'missing'
  const dueAt = row.nextAction?.dueAt
  if (!dueAt) return 'missing'
  const ms = Date.parse(dueAt)
  if (!Number.isFinite(ms)) return 'missing'
  return ms - now.getTime() <= PORTFOLIO_DUE_SOON_DAYS * DAY_MS ? 'due_soon' : 'scheduled'
}

/** Build ONE safe row. A positive-list constructor (file header): every field is
 *  named explicitly, so nothing can leak by being added upstream. */
export function buildPortfolioRow(input: PortfolioInputRow, now: Date): PortfolioRow {
  const channel = input.preferredChannel
  return {
    id: input.id,
    businessName: input.businessName,
    contactName: input.contactName,
    estado: input.estado,
    municipio: input.municipio,
    category: input.category,
    stage: input.stage,
    stageOrdinal: isStage(input.stage) ? STAGE_ORDINAL[input.stage] : 0,
    ageInStageDays: input.ageInStageDays,
    // `preferredChannelLabel` owns the lookup, including the reason it can't be
    // a bare `channel in LABELS`: `in` walks the prototype chain, so a stored
    // value of `'toString'` resolved to `Object.prototype.toString` and put a
    // FUNCTION where a Spanish label belongs (caught red by
    // e2e/portfolio-resolver.spec.ts). Centralising the guard means no future
    // call site can reintroduce it.
    preferredChannel: preferredChannelLabel(channel),
    nextActionId: input.nextAction?.id ?? null,
    nextActionDueAt: input.nextAction?.dueAt ?? null,
    missingAction: input.missingAction,
    blocker: input.blocker,
    consentState: input.consentState,
    openTaskCount: input.openTaskCount,
    lastInteractionAt: input.lastInteractionAt,
    stewardClerkUserId: input.stewardClerkUserId,
    assignmentHandoffNote: input.assignmentHandoffNote,
    assignedAt: input.assignedAt,
    dueState: deriveDueState(input, now),
    slaDueAt: input.sla.dueAt,
    slaOverdue: input.sla.overdue,
    slaOverdueReason: input.sla.overdueReason,
    escalationTarget: input.sla.escalationTarget,
    slaPolicyVersion: input.sla.policyVersion,
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** The default view is an ACTION QUEUE, not a dense CRM (build contract): only
 *  the rows a human has to do something about. `all` is the explicit opt-out. */
export type PortfolioView = 'needs_action' | 'all'

export interface PortfolioFilters {
  view: PortfolioView
  stage?: Stage
  blocker?: boolean
  dueState?: PortfolioDueState
}

/**
 * Parse the queue's URL params. Lives HERE (not in a `route.ts`) so the API
 * route and the `/partner` page import the ONE parser from a plain lib module,
 * and so a spec can walk every branch with no database — the same reasoning
 * `lib/scorecard/filters.ts#parseScorecardFilters` documents.
 *
 * Unrecognized values are DROPPED, never passed through: an unknown `stage=`
 * must not silently become a filter that matches nothing (which would look
 * identical to "this partner has no merchants"), and it must never reach a
 * query. `stage` is validated with the canonical `isStage`, not a local list.
 */
export function parsePortfolioFilters(params: URLSearchParams): PortfolioFilters {
  const rawStage = params.get('stage')
  const rawBlocker = params.get('blocker')
  const rawDue = params.get('due')
  const rawView = params.get('view')

  const due = DUE_STATES.find((s) => s === rawDue)

  return {
    view: rawView === 'all' ? 'all' : 'needs_action',
    stage: rawStage !== null && isStage(rawStage) ? rawStage : undefined,
    blocker: rawBlocker === 'true' ? true : rawBlocker === 'false' ? false : undefined,
    dueState: due,
  }
}

/** True when this row is something a human must act on: overdue, nothing
 *  scheduled, or explicitly blocked. `due_soon`/`scheduled` rows without a
 *  blocker are tended and stay out of the default view. */
export function needsAction(row: PortfolioRow): boolean {
  return row.dueState === 'overdue' || row.dueState === 'missing' || row.blocker
}

export function applyPortfolioFilters(rows: PortfolioRow[], filters: PortfolioFilters): PortfolioRow[] {
  let out = rows
  if (filters.view === 'needs_action') out = out.filter(needsAction)
  if (filters.stage !== undefined) out = out.filter((r) => r.stage === filters.stage)
  if (filters.blocker !== undefined) out = out.filter((r) => r.blocker === filters.blocker)
  if (filters.dueState !== undefined) out = out.filter((r) => r.dueState === filters.dueState)
  return out
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/** Overdue rows first, then rows with nothing scheduled, then everything else. */
function priorityBand(row: PortfolioRow): number {
  if (row.slaOverdue) return 0
  if (row.missingAction) return 1
  return 2
}

/** An unparseable/absent date sorts LAST within its band rather than first —
 *  a row we cannot date is not evidence of urgency. */
function sortableMs(iso: string | null): number {
  if (iso === null) return Number.POSITIVE_INFINITY
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

/**
 * TOTAL ordering (build contract): overdue first — most overdue first — then
 * missing-action, then next-action ascending, then `createdAt` descending.
 *
 * `id` ascending is the FINAL tiebreak. It is not in the contract's list
 * because the contract assumes `createdAt` distinguishes rows; two rows written
 * in the same millisecond would leave the comparator returning 0, which is
 * exactly the unstable-order class of bug LEARNINGS records. Ending on a unique
 * key makes the order provably total, and `e2e/portfolio-resolver.spec.ts`
 * proves it by ordering a shuffled fixture twice and asserting an identical
 * sequence.
 *
 * Within the overdue band the key is the SLA deadline (`slaDueAt`), so
 * "most overdue" is measured against the deadline the row was actually judged
 * by — a missed dated commitment sorts ahead of a merely stalled stage, because
 * the stalled row's deadline is still in the future.
 */
export function comparePortfolioRows(a: PortfolioRow, b: PortfolioRow, createdAtById: Map<string, string>): number {
  const bandDelta = priorityBand(a) - priorityBand(b)
  if (bandDelta !== 0) return bandDelta

  const band = priorityBand(a)
  if (band === 0 || band === 1) {
    const delta = sortableMs(a.slaDueAt) - sortableMs(b.slaDueAt)
    if (delta !== 0) return delta
  } else {
    const delta = sortableMs(a.nextActionDueAt) - sortableMs(b.nextActionDueAt)
    if (delta !== 0) return delta
  }

  const createdDelta = sortableMs(createdAtById.get(b.id) ?? null) - sortableMs(createdAtById.get(a.id) ?? null)
  if (createdDelta !== 0) return createdDelta

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Order a batch. `createdAt` is carried in a side map rather than on the DTO:
 *  it is a sort key, not something the queue renders, and the row stays a
 *  minimal safe projection. Never mutates the input array. */
export function orderPortfolioRows(rows: PortfolioRow[], createdAtById: Map<string, string>): PortfolioRow[] {
  return [...rows].sort((a, b) => comparePortfolioRows(a, b, createdAtById))
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface PortfolioSummary {
  total: number
  overdue: number
  missing: number
  dueSoon: number
  scheduled: number
  blocked: number
  needsAction: number
}

/** Counts over the FULL scoped population, computed BEFORE filters, so the
 *  queue can honestly say "5 de 29" instead of "5 de 5". */
export function summarizePortfolio(rows: PortfolioRow[]): PortfolioSummary {
  return {
    total: rows.length,
    overdue: rows.filter((r) => r.dueState === 'overdue').length,
    missing: rows.filter((r) => r.dueState === 'missing').length,
    dueSoon: rows.filter((r) => r.dueState === 'due_soon').length,
    scheduled: rows.filter((r) => r.dueState === 'scheduled').length,
    blocked: rows.filter((r) => r.blocker).length,
    needsAction: rows.filter(needsAction).length,
  }
}

export interface Portfolio {
  generatedAt: string
  slaPolicyVersion: number
  filters: PortfolioFilters
  summary: PortfolioSummary
  rows: PortfolioRow[]
}

/**
 * The whole pure pipeline in one call: build → summarize (unfiltered) → filter →
 * order. THIS is the function the API route, the `/partner` page and (Sprint 3)
 * the partner-agent tool all go through, so none of them can disagree about
 * what the queue contains or in what order.
 */
export function resolvePortfolio(
  inputs: PortfolioInputRow[],
  filters: PortfolioFilters,
  slaPolicyVersion: number,
  now: Date,
): Portfolio {
  const built = inputs.map((input) => buildPortfolioRow(input, now))
  const createdAtById = new Map(inputs.map((input) => [input.id, input.createdAt]))
  const summary = summarizePortfolio(built)
  const rows = orderPortfolioRows(applyPortfolioFilters(built, filters), createdAtById)
  return { generatedAt: now.toISOString(), slaPolicyVersion, filters, summary, rows }
}
