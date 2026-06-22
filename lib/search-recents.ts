// Recent-search helpers for the PWA bottom-sheet search (S2.1).
//
// The pure core (normalizeTerm / dedupeCap / searchHref) is next-free and
// DOM-free, so `e2e/search-recents.spec.ts` unit-tests it directly. The
// localStorage read/write functions are a thin browser-only shell over it and
// degrade to no-ops under SSR or when storage is unavailable/denied.

const STORAGE_KEY = 'ms:search:recents'

/** How many recent terms we keep (most-recent-first). */
export const RECENTS_CAP = 6

/** Trim and collapse internal whitespace. Blank input → ''. */
export function normalizeTerm(term: string): string {
  return term.replace(/\s+/g, ' ').trim()
}

/**
 * Prepend `term` to `list` — most-recent-first, case-insensitively de-duped,
 * capped to `cap`. A blank term is a no-op (returns the cleaned list, capped).
 * Pure: no storage, no DOM.
 */
export function dedupeCap(list: string[], term: string, cap: number = RECENTS_CAP): string[] {
  const cleaned = list.map(normalizeTerm).filter(Boolean)
  const next = normalizeTerm(term)
  if (!next) return cleaned.slice(0, cap)
  const rest = cleaned.filter((t) => t.toLowerCase() !== next.toLowerCase())
  return [next, ...rest].slice(0, cap)
}

/** Build the Medusa-backed listings search URL for a term (encoded). Blank → '/l'. */
export function searchHref(term: string): string {
  const q = normalizeTerm(term)
  return q ? `/l?q=${encodeURIComponent(q)}` : '/l'
}

// ── localStorage shell (browser-only) ───────────────────────────────────────

/** Read the stored recents, normalized + capped. Safe under SSR / disabled storage. */
export function readRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t): t is string => typeof t === 'string')
      .map(normalizeTerm)
      .filter(Boolean)
      .slice(0, RECENTS_CAP)
  } catch {
    return []
  }
}

/** Record `term` as the most-recent search and persist. Returns the new list. */
export function addRecent(term: string): string[] {
  const next = dedupeCap(readRecents(), term)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* quota / private-mode / denied — keep the in-memory list */
    }
  }
  return next
}

/** Clear all stored recents. Returns the (empty) list. */
export function clearRecents(): string[] {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  return []
}
