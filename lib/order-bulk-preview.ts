export type BulkOrderTransitionPlan = {
  order_id: string
  title: string | null
  current_status: string | null
  proposed_status: string
  eligible: boolean
  reason: string | null
}

export function reviewedStatusMap(plans: BulkOrderTransitionPlan[]): Record<string, string> {
  return Object.fromEntries(
    plans
      .filter((plan): plan is BulkOrderTransitionPlan & { current_status: string } => typeof plan.current_status === 'string')
      .map((plan) => [plan.order_id, plan.current_status]),
  )
}

/** Keep unresolved rows selected so the seller can correct and retry them. */
export function selectionAfterBulkApply(selected: ReadonlySet<string>, advanced: string[]): Set<string> {
  const next = new Set(selected)
  for (const id of advanced) next.delete(id)
  return next
}
