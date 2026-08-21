import { unionById } from './home-curation'
import type { Listing } from './types'

export type FetchSeleccionQuery = (query: string) => Promise<Listing[]>

const PIN_PAGE_SIZE = 100
// The backend reads at most 2,000 published products before filtering. Twenty
// 100-row pages therefore cover its complete featured population without an
// unbounded loop if that upstream contract ever returns a full final page.
const MAX_PIN_PAGES = 20

async function loadAllPinned(fetchQuery: FetchSeleccionQuery): Promise<Listing[]> {
  const pinned: Listing[] = []
  for (let page = 1; page <= MAX_PIN_PAGES; page += 1) {
    const batch = await fetchQuery(`?featured=true&limit=${PIN_PAGE_SIZE}&page=${page}`)
    pinned.push(...batch)
    if (batch.length < PIN_PAGE_SIZE) break
  }
  return pinned
}

/**
 * Build the admin's candidate pool from both discovery and authority.
 *
 * The recent read keeps the screen useful for finding new candidates; the explicit
 * featured read keeps every existing pin removable and reorderable even after bulk
 * imports push it outside the recent window. This mirrors the homepage curation
 * contract instead of giving the two surfaces different populations.
 */
export async function loadSeleccionCandidatePool(
  fetchQuery: FetchSeleccionQuery,
  recentLimit = 50,
): Promise<Listing[]> {
  const [fresh, pinned] = await Promise.all([
    fetchQuery(`?sort=reciente&limit=${recentLimit}`),
    loadAllPinned(fetchQuery),
  ])
  return unionById(fresh, pinned)
}
