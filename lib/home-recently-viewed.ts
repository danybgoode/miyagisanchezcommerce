/**
 * Recently-viewed ring buffer for the homepage rail (home-dynamic-rows-restore-and-polish
 * S2.3). Device-local only (localStorage) — no backend, no cross-device history (out of
 * scope per the epic seed). Mirrors `lib/search-recents.ts`'s exact pure-core/browser-shell
 * split: `dedupeCapViewed` is pure and DOM-free (unit-testable directly), the
 * read/record/clear functions are a thin, try/catch-wrapped, SSR-guarded shell over it.
 */

const STORAGE_KEY = 'ms:home:recently-viewed'

/** How many viewed listings we keep (most-recent-first) before the rail's own merge cap. */
export const RECENTLY_VIEWED_CAP = 20

export interface ViewedEntry {
  /** Medusa product id (matches `RecentFavorite.medusaId`). */
  id: string
  /** `Date.now()` at view time. */
  ts: number
}

/**
 * Prepend `entry` to `list` — most-recent-first, deduped by `id` (re-viewing bumps the
 * existing entry to the front with the new `ts` rather than duplicating it), capped to
 * `cap`. Pure: no storage, no DOM.
 */
export function dedupeCapViewed(list: ViewedEntry[], entry: ViewedEntry, cap: number = RECENTLY_VIEWED_CAP): ViewedEntry[] {
  const rest = list.filter((v) => v.id !== entry.id)
  return [entry, ...rest].slice(0, cap)
}

// ── localStorage shell (browser-only) ───────────────────────────────────────

function isViewedEntry(v: unknown): v is ViewedEntry {
  return (
    !!v && typeof v === 'object' &&
    typeof (v as ViewedEntry).id === 'string' && (v as ViewedEntry).id.length > 0 &&
    typeof (v as ViewedEntry).ts === 'number'
  )
}

/** Read the stored recently-viewed entries, capped. Safe under SSR / disabled storage. */
export function readRecentlyViewed(): ViewedEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isViewedEntry).slice(0, RECENTLY_VIEWED_CAP)
  } catch {
    return []
  }
}

/** Record a view of `id` now, and persist. Returns the new list. */
export function recordView(id: string): ViewedEntry[] {
  const next = dedupeCapViewed(readRecentlyViewed(), { id, ts: Date.now() })
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* quota / private-mode / denied — keep the in-memory list */
    }
  }
  return next
}

/** Clear all stored recently-viewed entries. Returns the (empty) list. */
export function clearRecentlyViewed(): ViewedEntry[] {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  return []
}
