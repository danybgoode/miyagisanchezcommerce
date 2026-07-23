/**
 * lib/relationship-pipeline.ts
 *
 * Founding merchant activation operations · Sprint 2 (Stories 2.2/2.3) — pure
 * computations shared by the promoter/admin operating views and their GET
 * routes: "the next action", overdue, age-in-stage, and the admin "blocker"
 * filter. Zero-import, same convention as `lib/merchant-stage.ts` — an `api`
 * spec walks every branch with no database.
 */

export interface OpenTaskFact {
  id: string
  dueAt: string | null
}

/**
 * "The next action" (sprint-2.md: "next action (or a visible 'sin próxima
 * acción' warning)") is the earliest-due OPEN task — a DATED one, always.
 *
 * C2 fix (PR 304 review): an undated open task no longer counts as "the next
 * action" at all. Acceptance 6 says a *dated* next action or a visible
 * warning — an earlier version fell back to returning an undated task when
 * no dated one existed, which made `isMissingAction` report `false` for a
 * merchant with only an undated task, hiding exactly the gap acceptance 6
 * exists to surface. An undated task a promoter created is NOT lost — it
 * still shows in the full task list `RelationshipHistoryPanel` renders from
 * `GET .../history` — it just never satisfies "scheduled".
 */
export function nextOpenTask(openTasks: OpenTaskFact[]): OpenTaskFact | null {
  const dated = openTasks
    .filter((t): t is OpenTaskFact & { dueAt: string } => t.dueAt !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  return dated.length > 0 ? dated[0] : null
}

/** True only when an open task exists, has a due date, and that date is in
 *  the past relative to `now`. An undated open task is never "overdue" —
 *  there is nothing to be late against. */
export function isOverdue(task: OpenTaskFact | null, now: Date): boolean {
  if (!task || task.dueAt === null) return false
  return new Date(task.dueAt).getTime() < now.getTime()
}

/**
 * True when there is no DATED open task — the "sin próxima acción" warning
 * condition (C2: an undated-only open task list is ALSO missing, matching
 * `nextOpenTask`'s "dated, always" rule above; they must never disagree).
 * Kept as its own function (rather than inlined as `nextOpenTask(...) ===
 * null`) so a spec can name the exact acceptance criterion ("every active
 * merchant is either scheduled or visibly missing an action") independently
 * of how "next" is picked.
 */
export function isMissingAction(openTasks: OpenTaskFact[]): boolean {
  return nextOpenTask(openTasks) === null
}

/** Whole days the relationship has sat in its current stage. Floors at 0 —
 *  a `stageEnteredAt` that reads as being in the future (clock skew, a bad
 *  write) never reports a negative age. */
export function ageInStageDays(stageEnteredAt: string, now: Date): number {
  const ms = now.getTime() - new Date(stageEnteredAt).getTime()
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0
}

/**
 * The admin "blocker" filter. The build contract names the filter
 * (`blocker`) without defining the term further; this repo's only existing
 * signal for "something is in the way of this merchant" is the Sprint 1
 * free-text `objections` field, so a non-blank `objections` is treated as a
 * blocker. This is a DIFFERENT use of that field than `merchant-stage.ts`'s
 * "a note is never evidence" rule — it never grants or influences a STAGE,
 * it only flags a row for a human's attention in a list. Documented here so
 * the choice is visible and revisable, not implied.
 */
export function hasBlocker(objections: string | null): boolean {
  return (objections ?? '').trim().length > 0
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/** True when `raw` has the exact `YYYY-MM-DD` SHAPE, independent of whether
 *  it's a real calendar date — lets a caller distinguish "shaped like a
 *  date-only value but calendar-invalid" (reject, D3e) from "not date-only
 *  at all" (fall back to parsing it as a full ISO datetime instead). */
export function isDateOnlyShape(raw: string): boolean {
  return DATE_ONLY_RE.test(raw)
}

/**
 * C8 fix (PR 304 review): a date-only `due_at` (the exact shape an
 * `<input type="date">` sends, e.g. "2026-07-23") must NOT be parsed as
 * `new Date("2026-07-23")` — that's midnight **UTC**, which renders as the
 * PREVIOUS calendar day in es-MX (UTC-6) and goes overdue hours before the
 * Mexico-City day the promoter picked has even started. Interpreted instead
 * as the END of that calendar day in Mexico City (23:59:59.999, fixed
 * UTC-6 — the same "no DST" simplification `lib/rental-checkout-display.ts`'s
 * `todayMx` already documents and this codebase already relies on) — a task
 * "due today" stays due until the Mexico-City day actually ends.
 *
 * Returns `null` for anything that isn't exactly `YYYY-MM-DD` — the CALLER
 * decides how to handle a non-date-only value (a full ISO datetime is passed
 * through unchanged; a malformed one is a 400).
 *
 * D3e fix (PR 304 review, round 3): also returns `null` for a shape-valid but
 * CALENDAR-invalid date (`2026-02-31`, `2026-02-30`). JS's `Date` parser does
 * NOT validate calendar correctness — it arithmetically ROLLS an out-of-range
 * day/month over into the next one, silently (`2026-02-31` becomes a March
 * date), the same way the numeric `Date.UTC(...)` constructor does.
 * `<input type="date">` can never produce such a value, but a direct API call
 * can, and normalizing it into a plausible-looking but WRONG due date is
 * worse than rejecting it outright. Caught by rendering the parsed instant
 * back to a Mexico-City calendar date and comparing it to the input — a
 * mismatch proves the input was never a real date.
 */
export function dueAtIsoFromDateOnly(raw: string): string | null {
  if (!DATE_ONLY_RE.test(raw)) return null
  const d = new Date(`${raw}T23:59:59.999-06:00`)
  if (Number.isNaN(d.getTime())) return null
  const roundTripped = d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  return roundTripped === raw ? d.toISOString() : null
}
