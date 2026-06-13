/**
 * lib/pdp-liveness.ts
 *
 * PDP redesign (#01) — Sprint 2, S2.2 (liveness / FOMO).
 *
 * The pure, next-free gates behind the PDP's two subtle "this item is in demand /
 * fresh" cues. No JSX, no network, no `next/*` import → unit-tested in the Playwright
 * `api` gate (the single source the page render + the spec both read, so they can't drift).
 *
 *  - Save count: "X personas lo guardaron", from a `marketplace_favorites` count the page
 *    queries. Gated at a threshold so a listing with 0–1 saves shows nothing (no anti-FOMO).
 *  - "Nuevo" badge: shown only while the listing is younger than the recency window,
 *    derived from `listing.created_at` (the same field the header's `timeAgo` reads).
 */

/** Minimum saves before the count surfaces — below this it reads as anti-social, not FOMO. */
export const SAVE_COUNT_THRESHOLD = 3

/** A listing counts as "Nuevo" for its first 48 hours. */
export const NEW_LISTING_WINDOW_MS = 48 * 60 * 60 * 1000

/** Show the save count only at/above the threshold (so 0–1 saves never render). */
export function shouldShowSaveCount(count: number | null | undefined, threshold = SAVE_COUNT_THRESHOLD): boolean {
  return typeof count === 'number' && Number.isFinite(count) && count >= threshold
}

/**
 * es-MX label for the save count. Singular/plural-safe even though the threshold means
 * the singular branch won't normally show — keeps the helper correct in isolation.
 */
export function saveCountLabel(count: number): string {
  return count === 1 ? '1 persona lo guardó' : `${count} personas lo guardaron`
}

/**
 * True while the listing is within the recency window (`< 48h`). Tolerant of a missing /
 * unparseable `created_at` (→ false) and of a future timestamp (→ true, still "new").
 *
 * @param createdAtIso the listing's `created_at` ISO string.
 * @param now epoch ms (injectable for deterministic tests). Defaults to `Date.now()`.
 */
export function isNewListing(createdAtIso: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAtIso) return false
  const created = Date.parse(createdAtIso)
  if (Number.isNaN(created)) return false
  return now - created < NEW_LISTING_WINDOW_MS
}
