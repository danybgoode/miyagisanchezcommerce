/**
 * Living Shop — Wall visibility and ordering (epic 07 · living-shop-social-storefront).
 *
 * Pure. `now` is always injected, never read from the clock inside, so a
 * schedule-boundary spec is a function call rather than a sleep.
 *
 * Scheduled publication runs with NO job and NO cron: an entry with
 * `status='scheduled'` and `scheduled_for` in the past IS public, decided at read
 * time. A cron that flips rows would add a moving part whose failure mode is a
 * merchant's launch silently not happening; deriving it removes that failure mode
 * entirely, at the cost of one comparison per read.
 */

import type { WallEntry, WallStatus } from './types'

/** The instant an entry is (or becomes) public. Null for a draft, which has none. */
export function effectiveInstant(entry: Pick<WallEntry, 'status' | 'published_at' | 'scheduled_for'>): string | null {
  if (entry.status === 'published') return entry.published_at
  if (entry.status === 'scheduled') return entry.scheduled_for
  return null
}

/** Whether a buyer may see this entry at `now`. Drafts never; scheduled only once due. */
export function isPubliclyVisible(
  entry: Pick<WallEntry, 'status' | 'published_at' | 'scheduled_for'>,
  now: Date,
): boolean {
  const at = effectiveInstant(entry)
  if (!at) return false
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return false
  return ms <= now.getTime()
}

/**
 * Public order: the pinned entry first, then everything else newest-first by
 * effective instant. Pinning changes PROMINENCE, not chronology — the pinned
 * entry keeps its own date and simply leads, which is why it is lifted out here
 * rather than given an artificial timestamp.
 *
 * Ties break on `id` so the order is total. Without that, two entries published
 * in the same millisecond would swap places between renders and the "load more"
 * cursor could skip or repeat one.
 */
export function orderPublicWall<T extends Pick<WallEntry, 'id' | 'status' | 'published_at' | 'scheduled_for' | 'pinned'>>(
  entries: T[],
  now: Date,
): T[] {
  const visible = entries.filter((e) => isPubliclyVisible(e, now))
  const pinned = visible.filter((e) => e.pinned)
  const rest = visible.filter((e) => !e.pinned)
  const byRecency = (a: T, b: T) => {
    const at = Date.parse(effectiveInstant(a) ?? '') || 0
    const bt = Date.parse(effectiveInstant(b) ?? '') || 0
    if (bt !== at) return bt - at
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  }
  // More than one pin cannot exist — the partial unique index forbids it — but
  // sorting them anyway keeps this total if the invariant is ever relaxed.
  return [...pinned.sort(byRecency), ...rest.sort(byRecency)]
}

/**
 * Which statuses a seller may move an entry to, given where it is now.
 *
 * Deterministic and total: every state names its own legal exits, so an
 * unreachable transition is a refusal with a reason rather than an update that
 * silently does nothing. `draft → scheduled` needs an instant; the validator
 * enforces that, not this table.
 */
export const WALL_TRANSITIONS: Record<WallStatus, readonly WallStatus[]> = {
  draft: ['published', 'scheduled'],
  published: ['draft', 'scheduled'],
  scheduled: ['draft', 'published'],
}

export function canTransition(from: WallStatus, to: WallStatus): boolean {
  if (from === to) return true
  return WALL_TRANSITIONS[from].includes(to)
}

/**
 * What `published_at` becomes for a status change. Publishing stamps the instant
 * once and KEEPS it across a later unpublish/republish round trip, so a merchant
 * who hides a post for an hour does not find it jumped to the top of their Wall
 * afterwards.
 */
export function nextPublishedAt(
  current: string | null,
  nextStatus: WallStatus,
  now: Date,
): string | null {
  if (nextStatus !== 'published') return current
  return current ?? now.toISOString()
}

/**
 * Split a page off an ordered Wall. Returns one extra lookahead as `hasMore` so
 * the caller can render "load more" without a second count query.
 */
export function paginate<T>(ordered: T[], offset: number, pageSize: number): { items: T[]; hasMore: boolean } {
  const start = Math.max(0, Math.floor(offset))
  const items = ordered.slice(start, start + pageSize)
  return { items, hasMore: ordered.length > start + items.length }
}
