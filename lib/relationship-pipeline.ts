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
 * acción' warning)") is the earliest-due OPEN task. Dated tasks sort by
 * `dueAt` ascending; an undated open task still counts as SOME next action
 * (it just isn't more urgent than a dated one), so dated tasks are preferred
 * and an undated one is only returned when there is no dated alternative.
 * `null` only when there is no open task at all — the caller renders the
 * "sin próxima acción" warning in that case, never for an undated one.
 */
export function nextOpenTask(openTasks: OpenTaskFact[]): OpenTaskFact | null {
  if (openTasks.length === 0) return null
  const dated = openTasks
    .filter((t): t is OpenTaskFact & { dueAt: string } => t.dueAt !== null)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  if (dated.length > 0) return dated[0]
  return openTasks[0]
}

/** True only when an open task exists, has a due date, and that date is in
 *  the past relative to `now`. An undated open task is never "overdue" —
 *  there is nothing to be late against. */
export function isOverdue(task: OpenTaskFact | null, now: Date): boolean {
  if (!task || task.dueAt === null) return false
  return new Date(task.dueAt).getTime() < now.getTime()
}

/** True exactly when there is no open task at all — the "sin próxima acción"
 *  warning condition. Kept as its own function (rather than inlined as
 *  `nextOpenTask(...) === null`) so a spec can name the exact acceptance
 *  criterion ("every active merchant is either scheduled or visibly missing
 *  an action") independently of how "next" is picked. */
export function isMissingAction(openTasks: OpenTaskFact[]): boolean {
  return openTasks.length === 0
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
