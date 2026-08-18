/**
 * Living Shop — what the Wall actually shows (epic 07, Sprint 2).
 *
 * Pure and next-free, so a spec can exercise it with no renderer. It lives here
 * rather than beside the component for a concrete reason: importing a `.tsx`
 * into a Playwright spec drags `next/link` through an ESM loader that cannot
 * resolve it, so a rule that lives in a component is a rule that cannot be
 * tested cheaply.
 */

import type { PublicWallEntry } from './types'

/**
 * Drop entries whose canonical object is gone, unpublished or foreign.
 *
 * ONE place, not one per card (S7.5's "one documented rule"): a dead reference
 * disappears rather than becoming broken chrome or — worse — a stale price that
 * still looks buyable. A plain post is never dropped; it has no reference to
 * lose.
 */
export function visibleEntries(entries: PublicWallEntry[]): PublicWallEntry[] {
  return entries.filter((e) => e.reference.state !== 'unavailable')
}
